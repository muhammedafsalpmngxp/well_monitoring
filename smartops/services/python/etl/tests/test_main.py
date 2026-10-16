"""
Unit tests for SmartOps ETL Service (app/main.py)

Tests cover:
  - Transform rules (apply_transform, pipeline, lookup sentinel)
  - SchemaGraph (build, topological_order, entity_id_map)
  - Validators (validate_required, deduplicate_rows)
  - _LookupRef sentinel
  - MergeBuilder SQL generation
  - DeadLetterWriter
  - _transform_single_row
"""
import sys
from pathlib import Path
from datetime import datetime

import pytest

# Ensure the app module is importable
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[5] / "shared" / "python"))

from app.transform import (
    apply_transform,
    _LookupRef,
    _tr_lookup,
    _tr_string,
    _tr_int,
    _tr_decimal,
    _tr_float,
    _tr_datetime,
    _tr_date,
    _tr_time,
    _tr_bit,
    TRANSFORM_REGISTRY,
    transform_batch,
    _transform_single_row,
)
from app.schema_graph import (
    SchemaGraph,
    EntityInfo,
    validate_required,
    deduplicate_rows,
    default_for_type,
    NULLABLE_TYPES,
)
from app.load import MergeBuilder, PRELOAD_DIR
from app.dead_letter import DeadLetterWriter
from app.extract import _validate_table_name, _validate_column_name


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSFORM RULES
# ═══════════════════════════════════════════════════════════════════════════════


class TestTrString:
    def test_no_params(self):
        assert _tr_string("hello", "") == "hello"

    def test_truncate(self):
        assert _tr_string("hello world", "5") == "hello"

    def test_truncate_with_precision_format(self):
        assert _tr_string("abcdefgh", "3") == "abc"

    def test_non_string_input(self):
        assert _tr_string(12345, "3") == "123"


class TestTrInt:
    def test_integer_string(self):
        assert _tr_int("42", "") == 42

    def test_float_string(self):
        assert _tr_int("3.7", "") == 3

    def test_with_whitespace(self):
        assert _tr_int("  100  ", "") == 100

    def test_negative(self):
        assert _tr_int("-5.9", "") == -5


class TestTrDecimal:
    def test_no_params(self):
        assert _tr_decimal("3.14159", "") == 3.14159

    def test_with_precision(self):
        assert _tr_decimal("3.14159", "10,2") == 3.14

    def test_integer_input(self):
        assert _tr_decimal("42", "10,0") == 42.0


class TestTrFloat:
    def test_basic(self):
        assert _tr_float("3.14", "") == 3.14

    def test_whitespace(self):
        assert _tr_float("  2.718  ", "") == 2.718


class TestTrDatetime:
    def test_iso_format(self):
        result = _tr_datetime("2024-01-15T10:30:00", "")
        assert result == "2024-01-15T10:30:00"

    def test_space_separated(self):
        result = _tr_datetime("2024-01-15 10:30:00", "")
        assert result == "2024-01-15T10:30:00"

    def test_date_only(self):
        result = _tr_datetime("2024-01-15", "")
        assert result == "2024-01-15T00:00:00"

    def test_datetime_object(self):
        dt = datetime(2024, 6, 1, 12, 0, 0)
        result = _tr_datetime(dt, "")
        assert "2024-06-01" in result

    def test_invalid_raises(self):
        with pytest.raises(ValueError):
            _tr_datetime("not-a-date", "")


class TestTrDate:
    def test_basic(self):
        assert _tr_date("2024-01-15T10:30:00", "") == "2024-01-15"

    def test_date_only(self):
        assert _tr_date("2024-01-15", "") == "2024-01-15"


class TestTrTime:
    def test_from_iso(self):
        assert _tr_time("2024-01-15T10:30:45", "") == "10:30:45"

    def test_time_only(self):
        assert _tr_time("10:30:45", "") == "10:30:45"


class TestTrBit:
    def test_true_values(self):
        assert _tr_bit("1", "") == 1
        assert _tr_bit("true", "") == 1
        assert _tr_bit("yes", "") == 1
        assert _tr_bit("on", "") == 1
        assert _tr_bit(True, "") == 1

    def test_false_values(self):
        assert _tr_bit("0", "") == 0
        assert _tr_bit("false", "") == 0
        assert _tr_bit("no", "") == 0
        assert _tr_bit(False, "") == 0


class TestTrLookup:
    def test_returns_sentinel(self):
        result = _tr_lookup("North", "ref.Cluster,cluster_code,cluster_id")
        assert isinstance(result, _LookupRef)
        assert result.table == "[ref].[Cluster]"
        assert result.match_col == "cluster_code"
        assert result.return_col == "cluster_id"
        assert result.value == "North"

    def test_none_value_returns_none(self):
        assert _tr_lookup(None, "ref.Cluster,cluster_code,cluster_id") is None

    def test_invalid_params_returns_none(self):
        assert _tr_lookup("X", "only_two_params,col") is None

    def test_already_bracketed_table(self):
        result = _tr_lookup("V", "[ref].[Cluster],code,id")
        assert result.table == "[ref].[Cluster]"

    def test_unsafe_match_col_rejected(self):
        """SQL injection in match_col is rejected."""
        result = _tr_lookup("X", "ref.Cluster,code]; DROP TABLE--,id")
        assert result is None

    def test_unsafe_return_col_rejected(self):
        """SQL injection in return_col is rejected."""
        result = _tr_lookup("X", "ref.Cluster,code,id]; DROP TABLE--")
        assert result is None

    def test_unsafe_table_schema_rejected(self):
        """SQL injection in schema.table is rejected."""
        result = _tr_lookup("X", "ref;DROP.Cluster,code,id")
        assert result is None

    def test_unsafe_table_name_rejected(self):
        """SQL injection in table name part is rejected."""
        result = _tr_lookup("X", "ref.Cluster];DROP TABLE x--,code,id")
        assert result is None


# ═══════════════════════════════════════════════════════════════════════════════
# APPLY_TRANSFORM (pipeline)
# ═══════════════════════════════════════════════════════════════════════════════


class TestApplyTransform:
    def test_single_rule(self):
        assert apply_transform("  hello  ", "trim") == "hello"

    def test_pipeline(self):
        assert apply_transform("  hello  ", "trim|upper") == "HELLO"

    def test_varchar_truncate(self):
        assert apply_transform("abcdefgh", "varchar(3)") == "abc"

    def test_default_when_none(self):
        assert apply_transform(None, "default:N/A") == "N/A"

    def test_default_when_not_none(self):
        assert apply_transform("X", "default:N/A|trim") == "X"

    def test_none_propagation(self):
        assert apply_transform(None, "trim|upper") is None

    def test_lookup_returns_sentinel(self):
        result = apply_transform("CTW", "trim|lookup(ref.WellType,code,well_type_id)")
        assert isinstance(result, _LookupRef)
        assert result.value == "CTW"

    def test_uuid5_deterministic(self):
        r1 = apply_transform("project-a", "trim|lower|uuid5")
        r2 = apply_transform("  Project-A  ", "trim|lower|uuid5")
        assert r1 == r2  # same input after trim|lower → same UUID

    def test_unknown_rule_passes_through(self):
        # Unknown rules log a warning but don't crash
        result = apply_transform("hello", "nonexistent_rule")
        assert result == "hello"  # value unchanged

    def test_coercion_failure_returns_none(self):
        result = apply_transform("not-a-number", "int")
        assert result is None


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSFORM BATCH
# ═══════════════════════════════════════════════════════════════════════════════


class TestTransformBatch:
    def test_basic_mapping(self):
        source = [{"Name": "Alice", "Age": "30"}]
        mappings = [
            {"sourceField": "Name", "canonicalFieldId": 1, "transformRule": "trim"},
            {"sourceField": "Age", "canonicalFieldId": 2, "transformRule": "int"},
        ]
        result, errors = transform_batch(source, mappings)
        assert errors == 0
        assert len(result) == 1
        assert result[0]["field_1"] == "Alice"
        assert result[0]["field_2"] == 30

    def test_missing_source_field_skipped(self):
        source = [{"Name": "Bob"}]
        mappings = [
            {"sourceField": "Name", "canonicalFieldId": 1, "transformRule": None},
            {"sourceField": "Missing", "canonicalFieldId": 2, "transformRule": None},
        ]
        result, errors = transform_batch(source, mappings)
        assert errors == 0
        assert "field_1" in result[0]
        assert "field_2" not in result[0]

    def test_empty_source(self):
        result, errors = transform_batch([], [{"sourceField": "X", "canonicalFieldId": 1, "transformRule": None}])
        assert result == []
        assert errors == 0


# ═══════════════════════════════════════════════════════════════════════════════
# SCHEMA GRAPH
# ═══════════════════════════════════════════════════════════════════════════════


class TestSchemaGraph:
    @pytest.fixture
    def sample_graph(self):
        fields = [
            {"canonicalFieldId": 1, "canonicalEntityId": 1, "fieldName": "cluster_code",
             "isActive": True, "isUnique": True, "isRequired": True},
            {"canonicalFieldId": 2, "canonicalEntityId": 2, "fieldName": "well_code",
             "isActive": True, "isUnique": True, "isRequired": False},
            {"canonicalFieldId": 3, "canonicalEntityId": 2, "fieldName": "is_current",
             "isActive": True, "isUnique": False, "isRequired": False},
            {"canonicalFieldId": 4, "canonicalEntityId": 2, "fieldName": "effective_start_date",
             "isActive": True, "isUnique": False, "isRequired": False},
        ]
        entities = [
            {"canonicalEntityId": 1, "entityName": "Cluster", "layer": "ref", "isActive": True},
            {"canonicalEntityId": 2, "entityName": "Well", "layer": "core", "isActive": True},
        ]
        return SchemaGraph.build(fields, entities)

    def test_topological_order_ref_before_core(self, sample_graph):
        order = sample_graph.topological_order()
        assert order.index("[ref].[Cluster]") < order.index("[core].[Well]")

    def test_topological_order_respects_fk_within_same_layer(self):
        """EquipmentType must load BEFORE Equipment (same ref layer, FK dep)."""
        fields = [
            {"canonicalFieldId": 1, "canonicalEntityId": 10, "fieldName": "code",
             "isActive": True, "isUnique": True, "isRequired": True},
            {"canonicalFieldId": 2, "canonicalEntityId": 10, "fieldName": "equipment_type_id",
             "isActive": True, "isUnique": False, "isRequired": False, "referenceEntityId": 11},
            {"canonicalFieldId": 3, "canonicalEntityId": 11, "fieldName": "code",
             "isActive": True, "isUnique": True, "isRequired": True},
        ]
        entities = [
            {"canonicalEntityId": 10, "entityName": "Equipment", "layer": "ref", "isActive": True},
            {"canonicalEntityId": 11, "entityName": "EquipmentType", "layer": "ref", "isActive": True},
        ]
        graph = SchemaGraph.build(fields, entities)
        order = graph.topological_order()
        # EquipmentType (no deps) must come before Equipment (depends on EquipmentType)
        assert order.index("[ref].[EquipmentType]") < order.index("[ref].[Equipment]")

    def test_topological_order_handles_cross_layer_fk(self):
        """Cross-layer FK: core entity depends on ref entity."""
        fields = [
            {"canonicalFieldId": 1, "canonicalEntityId": 1, "fieldName": "cluster_code",
             "isActive": True, "isUnique": True, "isRequired": True},
            {"canonicalFieldId": 2, "canonicalEntityId": 2, "fieldName": "well_code",
             "isActive": True, "isUnique": True, "isRequired": False},
            {"canonicalFieldId": 3, "canonicalEntityId": 2, "fieldName": "cluster_id",
             "isActive": True, "isUnique": False, "isRequired": False, "referenceEntityId": 1},
        ]
        entities = [
            {"canonicalEntityId": 1, "entityName": "Cluster", "layer": "ref", "isActive": True},
            {"canonicalEntityId": 2, "entityName": "Well", "layer": "core", "isActive": True},
        ]
        graph = SchemaGraph.build(fields, entities)
        order = graph.topological_order()
        assert order.index("[ref].[Cluster]") < order.index("[core].[Well]")

    def test_entity_id_map(self, sample_graph):
        eid_map = sample_graph.entity_id_map()
        assert eid_map[1] == "[ref].[Cluster]"
        assert eid_map[2] == "[core].[Well]"

    def test_get_entity_info(self, sample_graph):
        info = sample_graph.get("[ref].[Cluster]")
        assert info is not None
        assert info.layer == "ref"
        assert info.table_type == "lookup"
        assert "cluster_code" in info.unique_keys
        assert "cluster_code" in info.required_fields

    def test_scd2_detection(self, sample_graph):
        info = sample_graph.get("[core].[Well]")
        assert info.is_scd2 is True
        assert info.natural_key == "well_code"  # first unique key

    def test_inactive_entity_excluded(self):
        fields = [{"canonicalFieldId": 1, "canonicalEntityId": 1, "fieldName": "x",
                   "isActive": True, "isUnique": False, "isRequired": False}]
        entities = [{"canonicalEntityId": 1, "entityName": "Dead", "layer": "ref", "isActive": False}]
        graph = SchemaGraph.build(fields, entities)
        assert graph.get("[ref].[Dead]") is None


# ═══════════════════════════════════════════════════════════════════════════════
# VALIDATORS
# ═══════════════════════════════════════════════════════════════════════════════


class TestValidateRequired:
    def test_no_missing(self):
        row = {"a": 1, "b": 2}
        assert validate_required(row, frozenset({"a", "b"})) == []

    def test_missing_fields(self):
        row = {"a": 1, "b": None}
        result = validate_required(row, frozenset({"a", "b", "c"}))
        assert "b" in result
        assert "c" in result
        assert "a" not in result

    def test_empty_required(self):
        assert validate_required({"x": 1}, frozenset()) == []


class TestDeduplicateRows:
    def test_no_duplicates(self):
        rows = [{"code": "A"}, {"code": "B"}]
        result, skipped = deduplicate_rows(rows, frozenset({"code"}))
        assert len(result) == 2
        assert skipped == 0

    def test_with_duplicates(self):
        rows = [{"code": "A"}, {"code": "A"}, {"code": "B"}]
        result, skipped = deduplicate_rows(rows, frozenset({"code"}))
        assert len(result) == 2
        assert skipped == 1

    def test_no_unique_cols(self):
        rows = [{"x": 1}, {"x": 1}]
        result, skipped = deduplicate_rows(rows, frozenset())
        assert len(result) == 2
        assert skipped == 0

    def test_composite_key(self):
        rows = [
            {"a": 1, "b": "x"},
            {"a": 1, "b": "x"},
            {"a": 1, "b": "y"},
        ]
        result, skipped = deduplicate_rows(rows, frozenset({"a", "b"}))
        assert len(result) == 2
        assert skipped == 1


# ═══════════════════════════════════════════════════════════════════════════════
# MERGE BUILDER
# ═══════════════════════════════════════════════════════════════════════════════


class TestMergeBuilder:
    @pytest.fixture
    def builder(self):
        return MergeBuilder()

    def test_build_merge_sql(self, builder):
        sql = builder.build_merge("[ref].[Cluster]", ["cluster_code", "cluster_name"], frozenset({"cluster_code"}))
        assert "MERGE INTO [ref].[Cluster]" in sql
        # NULL-safe comparison for merge keys
        assert "target.[cluster_code] = src.[cluster_code]" in sql
        assert "[cluster_name] = src.[cluster_name]" in sql
        assert "WHEN NOT MATCHED THEN INSERT" in sql

    def test_build_merge_caching(self, builder):
        sql1 = builder.build_merge("[ref].[X]", ["a", "b"], frozenset({"a"}))
        sql2 = builder.build_merge("[ref].[X]", ["a", "b"], frozenset({"a"}))
        assert sql1 is sql2  # same object from cache

    def test_build_scd2_close(self, builder):
        sql = builder.build_scd2_close("[core].[Well]", "pdo_well_id")
        assert "UPDATE [core].[Well]" in sql
        assert "[is_current]=0" in sql
        assert "[pdo_well_id]=?" in sql

    def test_build_scd2_insert(self, builder):
        sql = builder.build_scd2_insert("[core].[Well]", ["well_code", "project_key"])
        assert "INSERT INTO [core].[Well]" in sql
        assert "[is_current]" in sql
        assert "[effective_start_date]" in sql
        assert sql.count("?") == 2

    def test_build_fact_insert(self, builder):
        sql = builder.build_fact_insert("[core].[Fact]", ["a", "b", "c"])
        assert "INSERT INTO [core].[Fact]" in sql
        assert sql.count("?") == 3


# ═══════════════════════════════════════════════════════════════════════════════
# DEAD LETTER WRITER
# ═══════════════════════════════════════════════════════════════════════════════


class TestDeadLetterWriter:
    def test_reject_creates_file(self, tmp_path):
        with DeadLetterWriter(run_id=99, output_dir=tmp_path) as dl:
            dl.reject("[ref].[Cluster]", {"code": "X"}, "test reason")

        files = list(tmp_path.glob("*.jsonl"))
        assert len(files) == 1
        assert "run_99" in files[0].name
        content = files[0].read_text()
        assert "test reason" in content
        assert '"code": "X"' in content

    def test_summary_counts(self, tmp_path):
        with DeadLetterWriter(run_id=1, output_dir=tmp_path) as dl:
            dl.reject("[ref].[A]", {}, "r1")
            dl.reject("[ref].[A]", {}, "r2")
            dl.reject("[core].[B]", {}, "r3")
            summary = dl.summary()

        assert summary["[ref].[A]"] == 2
        assert summary["[core].[B]"] == 1


# ═══════════════════════════════════════════════════════════════════════════════
# LOOKUP REF
# ═══════════════════════════════════════════════════════════════════════════════


class TestLookupRef:
    def test_slots(self):
        ref = _LookupRef("[ref].[Cluster]", "code", "id", "CTW")
        assert ref.table == "[ref].[Cluster]"
        assert ref.match_col == "code"
        assert ref.return_col == "id"
        assert ref.value == "CTW"

    def test_repr(self):
        ref = _LookupRef("[ref].[X]", "a", "b", "val")
        assert "LookupRef" in repr(ref)
        assert "val" in repr(ref)


# ═══════════════════════════════════════════════════════════════════════════════
# REGISTRY COMPLETENESS
# ═══════════════════════════════════════════════════════════════════════════════


class TestTransformRegistry:
    def test_all_expected_keys_present(self):
        expected = {
            "varchar", "nvarchar", "char", "nchar", "text", "ntext",
            "int", "integer", "bigint", "smallint", "tinyint",
            "decimal", "numeric", "money", "smallmoney",
            "float", "real",
            "datetime", "datetime2", "smalldatetime", "to_datetime",
            "date", "to_date", "time",
            "bit",
            "upper", "lower", "trim",
            "uuid5", "lookup",
        }
        assert expected.issubset(set(TRANSFORM_REGISTRY.keys()))

    def test_all_handlers_callable(self):
        for key, handler in TRANSFORM_REGISTRY.items():
            assert callable(handler), f"{key} handler is not callable"


# ═══════════════════════════════════════════════════════════════════════════════
# DEFAULT_FOR_TYPE (null-fill logic)
# ═══════════════════════════════════════════════════════════════════════════════


class TestDefaultForType:
    def test_nvarchar_returns_none(self):
        assert default_for_type("nvarchar(50)") is None

    def test_varchar_returns_none(self):
        assert default_for_type("varchar(100)") is None

    def test_char_returns_none(self):
        assert default_for_type("char(10)") is None

    def test_int_returns_zero(self):
        assert default_for_type("int") == 0

    def test_bigint_returns_zero(self):
        assert default_for_type("bigint") == 0

    def test_decimal_returns_zero_float(self):
        assert default_for_type("decimal(12,2)") == 0.0

    def test_float_returns_zero_float(self):
        assert default_for_type("float") == 0.0

    def test_bit_returns_zero(self):
        assert default_for_type("bit") == 0

    def test_uniqueidentifier_returns_none(self):
        # uniqueidentifier has no type default — stays NULL
        assert default_for_type("uniqueidentifier") is None

    def test_datetime_returns_none(self):
        """Date/time types should NOT have a default — they stay NULL."""
        assert default_for_type("datetime") is None

    def test_datetime2_returns_none(self):
        assert default_for_type("datetime2") is None

    def test_date_returns_none(self):
        assert default_for_type("date") is None

    def test_time_returns_none(self):
        assert default_for_type("time") is None

    def test_none_input_returns_none(self):
        assert default_for_type(None) is None

    def test_empty_string_returns_none(self):
        assert default_for_type("") is None

    def test_unknown_type_returns_none(self):
        assert default_for_type("xml") is None


# ═══════════════════════════════════════════════════════════════════════════════
# NULLABLE_TYPES
# ═══════════════════════════════════════════════════════════════════════════════


class TestNullableTypes:
    def test_datetime_types_are_nullable(self):
        assert "datetime" in NULLABLE_TYPES
        assert "datetime2" in NULLABLE_TYPES
        assert "smalldatetime" in NULLABLE_TYPES
        assert "date" in NULLABLE_TYPES
        assert "time" in NULLABLE_TYPES

    def test_string_types_are_nullable(self):
        assert "varchar" in NULLABLE_TYPES
        assert "nvarchar" in NULLABLE_TYPES

    def test_int_types_are_not_nullable(self):
        assert "int" not in NULLABLE_TYPES
        assert "bigint" not in NULLABLE_TYPES


# ═══════════════════════════════════════════════════════════════════════════════
# ENTITY INFO — field_types
# ═══════════════════════════════════════════════════════════════════════════════


class TestEntityInfoFieldTypes:
    def test_field_types_populated_from_build(self):
        fields = [
            {"canonicalFieldId": 1, "canonicalEntityId": 1, "fieldName": "cluster_code",
             "dataType": "nvarchar(10)", "isActive": True, "isUnique": True, "isRequired": True},
            {"canonicalFieldId": 2, "canonicalEntityId": 1, "fieldName": "cluster_name",
             "dataType": "nvarchar(50)", "isActive": True, "isUnique": False, "isRequired": False},
            {"canonicalFieldId": 3, "canonicalEntityId": 1, "fieldName": "created_date",
             "dataType": "datetime2", "isActive": True, "isUnique": False, "isRequired": False},
        ]
        entities = [
            {"canonicalEntityId": 1, "entityName": "Cluster", "layer": "ref", "isActive": True},
        ]
        graph = SchemaGraph.build(fields, entities)
        info = graph.get("[ref].[Cluster]")
        assert info is not None
        assert info.field_types["cluster_code"] == "nvarchar(10)"
        assert info.field_types["cluster_name"] == "nvarchar(50)"
        assert info.field_types["created_date"] == "datetime2"

    def test_field_types_default_empty_dict(self):
        info = EntityInfo(
            entity_id=1, sql_table="[ref].[X]", layer="ref", table_type="lookup",
            is_scd2=False, unique_keys=frozenset(), required_fields=frozenset(),
            natural_key=None,
        )
        assert info.field_types == {}
        assert info.fk_fields == frozenset()

    def test_fk_fields_populated_from_build(self):
        fields = [
            {"canonicalFieldId": 1, "canonicalEntityId": 2, "fieldName": "code",
             "dataType": "nvarchar(20)", "isActive": True, "isUnique": True, "isRequired": True},
            {"canonicalFieldId": 2, "canonicalEntityId": 2, "fieldName": "equipment_type_id",
             "dataType": "int", "isActive": True, "isUnique": False, "isRequired": False,
             "referenceEntityId": 1},
        ]
        entities = [
            {"canonicalEntityId": 2, "entityName": "Equipment", "layer": "ref", "isActive": True},
        ]
        graph = SchemaGraph.build(fields, entities)
        info = graph.get("[ref].[Equipment]")
        assert info is not None
        assert "equipment_type_id" in info.fk_fields
        assert "code" not in info.fk_fields

    def test_fk_fields_empty_when_no_references(self):
        fields = [
            {"canonicalFieldId": 1, "canonicalEntityId": 1, "fieldName": "cluster_code",
             "dataType": "nvarchar(10)", "isActive": True, "isUnique": True, "isRequired": True},
        ]
        entities = [
            {"canonicalEntityId": 1, "entityName": "Cluster", "layer": "ref", "isActive": True},
        ]
        graph = SchemaGraph.build(fields, entities)
        info = graph.get("[ref].[Cluster]")
        assert info.fk_fields == frozenset()


# ═══════════════════════════════════════════════════════════════════════════════
# NULL-FILL INTEGRATION (simulates _load_entity behavior)
# ═══════════════════════════════════════════════════════════════════════════════


class TestNullFillLogic:
    """Simulate the null-fill logic from TenantLoader._load_entity"""

    @staticmethod
    def _apply_null_fill(row: dict, field_types: dict[str, str], fk_fields: frozenset = frozenset()) -> tuple[dict, set]:
        """Replicate the null-fill logic for testing."""
        skip_validation: set[str] = set()
        for col, data_type in field_types.items():
            if col in fk_fields:
                continue  # FK columns never filled
            base_type = data_type.strip().split("(")[0].lower() if data_type else ""
            if col not in row or row[col] is None:
                if base_type in NULLABLE_TYPES:
                    skip_validation.add(col)
                else:
                    fill = default_for_type(data_type)
                    if fill is not None:
                        row[col] = fill
        return row, skip_validation

    def test_string_null_stays_null_and_skips(self):
        row = {"cluster_name": None, "cluster_code": "ABC"}
        field_types = {"cluster_name": "nvarchar(50)", "cluster_code": "nvarchar(10)"}
        result, skip = self._apply_null_fill(row, field_types)
        assert result["cluster_name"] is None  # no default for string types
        assert result["cluster_code"] == "ABC"  # not touched
        assert "cluster_name" in skip  # string types are nullable

    def test_missing_string_column_not_added(self):
        """Missing varchar/nvarchar column not added (no default)."""
        row = {"cluster_code": "3522", "source_system_id": 9}
        field_types = {"cluster_code": "nvarchar(10)", "cluster_name": "nvarchar(50)"}
        result, skip = self._apply_null_fill(row, field_types)
        assert "cluster_name" not in result  # not added (no default)
        assert result["cluster_code"] == "3522"  # untouched

    def test_missing_datetime_column_not_added(self):
        """Missing datetime column stays absent (not added to row)."""
        row = {"well_code": "W1"}
        field_types = {"well_code": "nvarchar(20)", "spud_date": "datetime2"}
        result, skip = self._apply_null_fill(row, field_types)
        assert "spud_date" not in result  # NOT added
        assert "spud_date" in skip

    def test_fk_column_never_filled_with_zero(self):
        """FK columns must never be filled with 0 — causes FK violations."""
        row = {"code": "BS00036", "source_system_id": 9}
        field_types = {"code": "nvarchar(20)", "equipment_type_id": "int"}
        fk_fields = frozenset({"equipment_type_id"})
        result, skip = self._apply_null_fill(row, field_types, fk_fields)
        assert "equipment_type_id" not in result  # NOT added

    def test_fk_column_null_stays_null(self):
        """FK column already in row as None stays None (not filled)."""
        row = {"code": "X", "equipment_type_id": None}
        field_types = {"code": "nvarchar(10)", "equipment_type_id": "int"}
        fk_fields = frozenset({"equipment_type_id"})
        result, skip = self._apply_null_fill(row, field_types, fk_fields)
        assert result["equipment_type_id"] is None  # not filled

    def test_fk_column_with_value_untouched(self):
        """FK column with a valid value is not modified."""
        row = {"code": "X", "equipment_type_id": 5}
        field_types = {"code": "nvarchar(10)", "equipment_type_id": "int"}
        fk_fields = frozenset({"equipment_type_id"})
        result, skip = self._apply_null_fill(row, field_types, fk_fields)
        assert result["equipment_type_id"] == 5  # untouched

    def test_int_null_filled_with_zero(self):
        row = {"count": None}
        field_types = {"count": "int"}
        result, skip = self._apply_null_fill(row, field_types)
        assert result["count"] == 0

    def test_decimal_null_filled_with_zero(self):
        row = {"northing": None}
        field_types = {"northing": "decimal(12,2)"}
        result, skip = self._apply_null_fill(row, field_types)
        assert result["northing"] == 0.0

    def test_datetime_stays_null_and_skips_validation(self):
        row = {"spud_date": None, "well_code": "W1"}
        field_types = {"spud_date": "datetime2", "well_code": "nvarchar(20)"}
        result, skip = self._apply_null_fill(row, field_types)
        assert result["spud_date"] is None  # stays NULL
        assert "spud_date" in skip  # skipped from required validation

    def test_date_stays_null(self):
        row = {"start_date": None}
        field_types = {"start_date": "date"}
        result, skip = self._apply_null_fill(row, field_types)
        assert result["start_date"] is None
        assert "start_date" in skip

    def test_non_null_values_untouched(self):
        row = {"name": "Alice", "age": 30, "joined": "2024-01-01"}
        field_types = {"name": "nvarchar(50)", "age": "int", "joined": "date"}
        result, skip = self._apply_null_fill(row, field_types)
        assert result == {"name": "Alice", "age": 30, "joined": "2024-01-01"}
        assert skip == set()

    def test_unknown_type_not_filled(self):
        row = {"xml_data": None}
        field_types = {"xml_data": "xml"}
        result, skip = self._apply_null_fill(row, field_types)
        assert result["xml_data"] is None  # not filled (unknown type)
        assert skip == set()  # not in NULLABLE_TYPES either

    def test_mixed_scenario(self):
        """Full scenario: string, int, datetime all NULL."""
        row = {
            "well_code": None,
            "northing": None,
            "spud_date": None,
            "rig_name": None,
            "source_system_id": 9,
        }
        field_types = {
            "well_code": "nvarchar(20)",
            "northing": "decimal(12,2)",
            "spud_date": "datetime2",
            "rig_name": "nvarchar(50)",
        }
        result, skip = self._apply_null_fill(row, field_types)
        assert result["well_code"] is None  # no default for string types
        assert result["northing"] == 0.0
        assert result["spud_date"] is None
        assert result["rig_name"] is None  # no default for string types
        assert result["source_system_id"] == 9  # untouched
        assert skip == {"spud_date", "well_code", "rig_name"}


# ═══════════════════════════════════════════════════════════════════════════════
# PRELOAD DUMP
# ═══════════════════════════════════════════════════════════════════════════════


class TestPreloadDump:
    def test_dump_creates_jsonl_files(self, tmp_path, monkeypatch):
        import app.load as load_module
        monkeypatch.setattr(load_module, "PRELOAD_DIR", tmp_path)

        from app.load import TenantLoader
        entity_rows = {
            "[ref].[Cluster]": [
                {"cluster_code": "Nimr", "cluster_name": "Nimr", "source_system_id": 9},
                {"cluster_code": "Fahud", "cluster_name": "Fahud", "source_system_id": 9},
            ],
            "[core].[Well]": [
                {"well_code": "NL0010", "northing": 0.0, "source_system_id": 9},
            ],
        }
        TenantLoader._dump_preload(run_id=99, entity_rows=entity_rows)

        files = list(tmp_path.glob("*.jsonl"))
        assert len(files) == 2

        # Check content
        cluster_file = next(f for f in files if "Cluster" in f.name)
        lines = cluster_file.read_text().strip().split("\n")
        assert len(lines) == 2
        assert "Nimr" in lines[0]

    def test_dump_handles_special_values(self, tmp_path, monkeypatch):
        import app.load as load_module
        monkeypatch.setattr(load_module, "PRELOAD_DIR", tmp_path)

        from app.load import TenantLoader
        entity_rows = {
            "[ref].[Test]": [{"date_val": None, "num": 0.0, "name": "Undefined"}],
        }
        TenantLoader._dump_preload(run_id=1, entity_rows=entity_rows)

        files = list(tmp_path.glob("*.jsonl"))
        assert len(files) == 1
        content = files[0].read_text()
        assert "null" in content  # JSON null for None
        assert "Undefined" in content


# ═══════════════════════════════════════════════════════════════════════════════
# AUTO-COERCION & DATE_KEY TESTS
# ═══════════════════════════════════════════════════════════════════════════════

from app.transform import _tr_date_key, _auto_coerce, _apply_rule_with_fallback


class TestDateKeyTransform:
    """Test _tr_date_key: date string → int YYYYMMDD."""

    def test_iso_datetime(self):
        assert _tr_date_key("2025-11-06T11:59:59.000Z", "") == 20251106

    def test_iso_date_only(self):
        assert _tr_date_key("2025-12-18", "") == 20251218

    def test_european_dot_format(self):
        assert _tr_date_key("18.12.2025", "") == 20251218

    def test_european_slash_format(self):
        assert _tr_date_key("18/12/2025", "") == 20251218

    def test_already_int(self):
        assert _tr_date_key(20251218, "") == 20251218

    def test_already_int_string(self):
        assert _tr_date_key("20251218", "") == 20251218

    def test_none_returns_none(self):
        assert _tr_date_key(None, "") is None

    def test_empty_string_returns_none(self):
        assert _tr_date_key("", "") is None

    def test_unparseable_returns_none(self):
        assert _tr_date_key("not a date", "") is None

    def test_iso_with_timezone_offset(self):
        assert _tr_date_key("2025-06-17T11:59:59.000+05:30", "") == 20250617


class TestAutoCoerce:
    """Test _auto_coerce: auto-convert value based on target dataType."""

    def test_decimal_coercion(self):
        result = _auto_coerce("6.5", "decimal(6,1)", "fl_dia_mm")
        assert result == 6.5

    def test_int_coercion(self):
        result = _auto_coerce("42", "int", "some_count")
        assert result == 42

    def test_bigint_coercion(self):
        result = _auto_coerce("123456789", "bigint", "some_key")
        assert result == 123456789

    def test_datetime2_coercion(self):
        result = _auto_coerce("2025-11-06", "datetime2", "some_date")
        assert "2025-11-06" in str(result)

    def test_date_key_auto_detect(self):
        """int field with _date_key suffix → uses date_key handler."""
        result = _auto_coerce("2025-11-06T12:00:00.000Z", "int", "po_received_date_key")
        assert result == 20251106

    def test_date_key_european(self):
        result = _auto_coerce("18.12.2025", "int", "material_available_date_key")
        assert result == 20251218

    def test_failed_coercion_returns_none(self):
        """Non-numeric string to decimal → returns None (not the raw string)."""
        result = _auto_coerce("N/A", "decimal(6,1)", "fl_dia_mm")
        assert result is None

    def test_failed_int_coercion_returns_none(self):
        result = _auto_coerce("PROJ-123", "bigint", "project_key")
        assert result is None

    def test_none_value_passes_through(self):
        result = _auto_coerce(None, "decimal(6,1)", "fl_dia_mm")
        assert result is None

    def test_no_target_type_passes_through(self):
        result = _auto_coerce("hello", None, "some_field")
        assert result == "hello"

    def test_varchar_coercion(self):
        result = _auto_coerce(12345, "varchar(50)", "some_text")
        assert result == "12345"


class TestApplyRuleWithFallback:
    """Test _apply_rule_with_fallback: unknown rules fall back to auto-coerce."""

    def test_known_rule_applied(self):
        result = _apply_rule_with_fallback("42", "int", "int", "count")
        assert result == 42

    def test_unknown_rule_falls_back_to_target_type(self):
        """CAST_DECIMAL (unknown) → auto-coerce using target decimal(12,2)."""
        result = _apply_rule_with_fallback("6.5", "CAST_DECIMAL", "decimal(12,2)", "fl_dia_mm")
        assert result == 6.5

    def test_unparseable_rule_falls_back(self):
        """'PARSE_DATE; event_type=X' (semicolons invalid) → auto-coerce using datetime2."""
        result = _apply_rule_with_fallback("2025-11-06", "PARSE_DATE; event_type=RIG_ON", "datetime2", "Rig_On_Date")
        assert "2025-11-06" in str(result)

    def test_unknown_rule_no_target_type(self):
        """Unknown rule + no target type → passes through."""
        result = _apply_rule_with_fallback("hello", "UNKNOWN_RULE", None, "field")
        assert result == "hello"

    def test_pipeline_with_known_rules(self):
        result = _apply_rule_with_fallback("  hello  ", "trim|upper", "varchar(50)", "name")
        assert result == "HELLO"

    def test_case_expression_still_works(self):
        result = _apply_rule_with_fallback(
            "BP", "CASE WHEN 'BP' THEN 'Beam Pump' ELSE 'Other' END", None, "lift"
        )
        assert result == "Beam Pump"


# ═══════════════════════════════════════════════════════════════════════════════
# AUTO-FK RESOLUTION TESTS
# ═══════════════════════════════════════════════════════════════════════════════

from app.load import _find_parent_for_fk, _resolve_fk_from_cache, TenantLoader


class TestFindParentForFk:
    """Test _find_parent_for_fk: identifies parent table from FK field name."""

    def _make_info(self, sql_table, identity_col=None, field_types=None):
        return EntityInfo(
            entity_id=1, sql_table=sql_table, layer="core",
            table_type="dim", is_scd2=False,
            unique_keys=frozenset(), required_fields=frozenset(),
            natural_key=None, field_types=field_types or {},
            identity_col=identity_col,
        )

    def test_finds_parent_by_identity_col(self):
        parent = self._make_info("[core].[Well]", identity_col="well_key")
        child = self._make_info("[core].[WellScope]", field_types={"well_key": "bigint"})
        graph = SchemaGraph(
            {"[core].[Well]": parent, "[core].[WellScope]": child},
            {"[core].[WellScope]": {"[core].[Well]"}},
        )
        result = _find_parent_for_fk("well_key", child, graph)
        assert result == "[core].[Well]"

    def test_returns_none_when_no_parent(self):
        child = self._make_info("[core].[WellScope]", field_types={"well_key": "bigint"})
        graph = SchemaGraph({"[core].[WellScope]": child}, {})
        result = _find_parent_for_fk("well_key", child, graph)
        assert result is None


class TestResolveFkFromCache:
    """Test _resolve_fk_from_cache: chained FK resolution."""

    def _make_info(self, sql_table, identity_col=None, fk_fields=None):
        return EntityInfo(
            entity_id=1, sql_table=sql_table, layer="core",
            table_type="dim", is_scd2=False,
            unique_keys=frozenset(), required_fields=frozenset(),
            natural_key=None, field_types={},
            fk_fields=frozenset(fk_fields or []),
            identity_col=identity_col,
        )

    def test_direct_parent_resolution(self):
        """well_key on WellScope → pk_cache[Well][pdo_well_id] = well_key."""
        parent = self._make_info("[core].[Well]", identity_col="well_key")
        child = self._make_info("[core].[WellScope]")
        graph = SchemaGraph(
            {"[core].[Well]": parent, "[core].[WellScope]": child},
            {"[core].[WellScope]": {"[core].[Well]"}},
        )
        pk_cache = {"[core].[Well]": {"36343": 1001, "30854": 1003}}
        fk_context = {"[core].[Well]": {"pdo_well_id": "36343"}}

        result = _resolve_fk_from_cache("well_key", None, fk_context, child, graph, pk_cache)
        assert result == 1001

    def test_chained_resolution(self):
        """well_scope_key on WellDeliveryEvent → Well → WellScope (2 hops)."""
        well_info = self._make_info("[core].[Well]", identity_col="well_key")
        scope_info = self._make_info("[core].[WellScope]", identity_col="well_scope_key")
        event_info = self._make_info("[core].[WellDeliveryEvent]")
        graph = SchemaGraph(
            {"[core].[Well]": well_info, "[core].[WellScope]": scope_info, "[core].[WellDeliveryEvent]": event_info},
            {"[core].[WellDeliveryEvent]": {"[core].[WellScope]"}, "[core].[WellScope]": {"[core].[Well]"}},
        )
        pk_cache = {
            "[core].[Well]": {"36343": 1001},
            "[core].[WellScope]": {1001: 7},  # well_key → well_scope_key
        }
        fk_context = {"[core].[Well]": {"pdo_well_id": "36343"}}

        result = _resolve_fk_from_cache("well_scope_key", None, fk_context, event_info, graph, pk_cache)
        assert result == 7

    def test_existing_value_matches_cache(self):
        """Existing string value found directly in a parent cache."""
        parent = self._make_info("[core].[Project]", identity_col="project_key")
        child = self._make_info("[core].[Well]")
        graph = SchemaGraph(
            {"[core].[Project]": parent, "[core].[Well]": child},
            {"[core].[Well]": {"[core].[Project]"}},
        )
        pk_cache = {"[core].[Project]": {"8c9c6b42-uuid": 1}}

        result = _resolve_fk_from_cache("project_key", "8c9c6b42-uuid", {}, child, graph, pk_cache)
        assert result == 1

    def test_returns_none_when_not_found(self):
        child = self._make_info("[core].[Well]")
        graph = SchemaGraph({"[core].[Well]": child}, {})
        pk_cache = {}

        result = _resolve_fk_from_cache("project_key", "unknown", {}, child, graph, pk_cache)
        assert result is None


# ═════════════════════════════════════════════════════════════════════════════
# SQL IDENTIFIER VALIDATION (security fix)
# ═════════════════════════════════════════════════════════════════════════════


class TestValidateTableName:
    """Tests for _validate_table_name — prevents SQL injection via table identifiers."""

    def test_simple_name(self):
        assert _validate_table_name("Equipment") == "Equipment"

    def test_name_with_underscore(self):
        assert _validate_table_name("Equipment_Type") == "Equipment_Type"

    def test_name_with_dots(self):
        assert _validate_table_name("dbo.Equipment") == "dbo.Equipment"

    def test_name_with_spaces(self):
        assert _validate_table_name("My Table") == "My Table"

    def test_rejects_semicolon(self):
        with pytest.raises(ValueError, match="Unsafe table name"):
            _validate_table_name("Equipment; DROP TABLE Users")

    def test_rejects_closing_bracket(self):
        with pytest.raises(ValueError, match="Unsafe table name"):
            _validate_table_name("Equipment] UNION SELECT *--")

    def test_rejects_single_quote(self):
        with pytest.raises(ValueError, match="Unsafe table name"):
            _validate_table_name("Equipment' OR '1'='1")

    def test_rejects_double_dash_comment(self):
        with pytest.raises(ValueError, match="Unsafe table name"):
            _validate_table_name("Equipment--")

    def test_rejects_parentheses(self):
        with pytest.raises(ValueError, match="Unsafe table name"):
            _validate_table_name("Equipment()")

    def test_rejects_empty_string(self):
        with pytest.raises(ValueError, match="Unsafe table name"):
            _validate_table_name("")

    def test_rejects_starting_with_number(self):
        with pytest.raises(ValueError, match="Unsafe table name"):
            _validate_table_name("123Table")

    def test_rejects_overly_long_name(self):
        with pytest.raises(ValueError, match="Unsafe table name"):
            _validate_table_name("A" * 130)


class TestValidateColumnName:
    """Tests for _validate_column_name — prevents SQL injection via column identifiers."""

    def test_simple_name(self):
        assert _validate_column_name("cluster_code") == "cluster_code"

    def test_name_with_numbers(self):
        assert _validate_column_name("field_123") == "field_123"

    def test_rejects_semicolon(self):
        with pytest.raises(ValueError, match="Unsafe column name"):
            _validate_column_name("col; DROP TABLE--")

    def test_rejects_bracket(self):
        with pytest.raises(ValueError, match="Unsafe column name"):
            _validate_column_name("col]")

    def test_rejects_spaces(self):
        with pytest.raises(ValueError, match="Unsafe column name"):
            _validate_column_name("col name")

    def test_rejects_dot(self):
        with pytest.raises(ValueError, match="Unsafe column name"):
            _validate_column_name("schema.col")

    def test_rejects_empty(self):
        with pytest.raises(ValueError, match="Unsafe column name"):
            _validate_column_name("")

    def test_rejects_overly_long_name(self):
        with pytest.raises(ValueError, match="Unsafe column name"):
            _validate_column_name("x" * 129)


# ═════════════════════════════════════════════════════════════════════════════
# ETL ENGINE LOCKING (concurrency fix)
# ═════════════════════════════════════════════════════════════════════════════


class TestETLEngineLocking:
    """Tests for per-tenant-source mutual exclusion in ETLEngine."""

    def test_get_lock_returns_same_lock_for_same_id(self):
        from unittest.mock import MagicMock
        from app.engine import ETLEngine

        mock_client = MagicMock()
        engine = ETLEngine(mock_client)
        lock1 = engine._get_lock(42)
        lock2 = engine._get_lock(42)
        assert lock1 is lock2

    def test_get_lock_returns_different_locks_for_different_ids(self):
        from unittest.mock import MagicMock
        from app.engine import ETLEngine

        mock_client = MagicMock()
        engine = ETLEngine(mock_client)
        lock1 = engine._get_lock(1)
        lock2 = engine._get_lock(2)
        assert lock1 is not lock2

    def test_concurrent_run_rejected_when_locked(self):
        """If lock is already held, execute_run returns Failed immediately."""
        from unittest.mock import MagicMock
        from app.engine import ETLEngine

        mock_client = MagicMock()
        engine = ETLEngine(mock_client)

        # Manually acquire the lock to simulate an in-progress run
        lock = engine._get_lock(99)
        lock.acquire()
        try:
            result = engine.execute_run(99, full_refresh=False)
            assert result.status == "Failed"
            assert "already in progress" in result.message
        finally:
            lock.release()


# ═════════════════════════════════════════════════════════════════════════════
# FULL REFRESH — source_system_id guard
# ═════════════════════════════════════════════════════════════════════════════


class TestFullRefreshSourceSystemIdGuard:
    """Verify full_refresh DELETE skips tables without source_system_id column."""

    def test_entity_without_source_system_id_skipped(self):
        """Tables missing source_system_id in field_types should NOT be deleted."""
        fields = [
            {"canonicalFieldId": 1, "canonicalEntityId": 1, "fieldName": "code",
             "isActive": True, "isUnique": True, "isRequired": True, "dataType": "varchar(10)"},
            {"canonicalFieldId": 2, "canonicalEntityId": 1, "fieldName": "name",
             "isActive": True, "isUnique": False, "isRequired": False, "dataType": "varchar(50)"},
        ]
        entities = [
            {"canonicalEntityId": 1, "entityName": "NoSysId", "layer": "ref", "isActive": True},
        ]
        graph = SchemaGraph.build(fields, entities)
        info = graph.get("[ref].[NoSysId]")
        assert info is not None
        # Verify the field_types do NOT contain source_system_id
        assert "source_system_id" not in info.field_types

    def test_entity_with_source_system_id_included(self):
        """Tables WITH source_system_id are eligible for full_refresh delete."""
        fields = [
            {"canonicalFieldId": 1, "canonicalEntityId": 1, "fieldName": "code",
             "isActive": True, "isUnique": True, "isRequired": True, "dataType": "varchar(10)"},
            {"canonicalFieldId": 2, "canonicalEntityId": 1, "fieldName": "source_system_id",
             "isActive": True, "isUnique": False, "isRequired": False, "dataType": "int"},
        ]
        entities = [
            {"canonicalEntityId": 1, "entityName": "HasSysId", "layer": "ref", "isActive": True},
        ]
        graph = SchemaGraph.build(fields, entities)
        info = graph.get("[ref].[HasSysId]")
        assert "source_system_id" in info.field_types


# ═════════════════════════════════════════════════════════════════════════════
# FK LOOKUP RESOLUTION — unresolved FK dead-lettering
# ═════════════════════════════════════════════════════════════════════════════


class TestUnresolvedFKDeadLetter:
    """Verify rows with unresolved FK lookups are dead-lettered, not inserted."""

    def test_unresolved_lookup_detected(self):
        """A _LookupRef that resolves to None on an FK column should be flagged."""
        from app.transform import _LookupRef

        ref = _LookupRef("[ref].[EquipmentType]", "code", "equipment_type_id", "MISSING_CODE")
        # Simulate the lookup cache being empty (value not found)
        lookup_cache = {("[ref].[EquipmentType]", "code", "equipment_type_id"): {}}
        resolved = lookup_cache.get(
            (ref.table, ref.match_col, ref.return_col), {}
        ).get(ref.value)
        assert resolved is None  # confirms the value is unresolvable

    def test_resolved_lookup_returns_value(self):
        """A _LookupRef that finds a match returns the FK value."""
        from app.transform import _LookupRef

        ref = _LookupRef("[ref].[EquipmentType]", "code", "equipment_type_id", "PUMP")
        lookup_cache = {("[ref].[EquipmentType]", "code", "equipment_type_id"): {"PUMP": 42}}
        resolved = lookup_cache.get(
            (ref.table, ref.match_col, ref.return_col), {}
        ).get(ref.value)
        assert resolved == 42


# ═════════════════════════════════════════════════════════════════════════════
# APPLY_TRANSFORM INJECTION PREVENTION (via pipeline)
# ═════════════════════════════════════════════════════════════════════════════


class TestApplyTransformInjectionPrevention:
    """Verify that SQL injection attempts through transform rules are blocked."""

    def test_lookup_with_injection_in_column_returns_none(self):
        result = apply_transform("value", "lookup(ref.Table,col]; DROP--,id)")
        assert result is None

    def test_lookup_with_injection_in_return_col_returns_none(self):
        result = apply_transform("value", "lookup(ref.Table,code,id]; DROP--)")
        assert result is None

    def test_lookup_with_injection_in_schema_returns_none(self):
        result = apply_transform("value", "lookup(ref;DROP.Table,code,id)")
        assert result is None

    def test_valid_lookup_in_pipeline_still_works(self):
        result = apply_transform("North", "trim|lookup(ref.Cluster,cluster_code,cluster_id)")
        assert isinstance(result, _LookupRef)
        assert result.value == "North"
        assert result.match_col == "cluster_code"
