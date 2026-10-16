DECLARE @start_date DATE = '2026-01-01';
DECLARE @end_date DATE = CAST(GETDATE() AS DATE);
DECLARE @mode VARCHAR(10) = 'total';
DECLARE @cluster VARCHAR(20) = NULL;
DECLARE @plant NVARCHAR(100) = NULL;

;WITH FWM AS
(
    SELECT DISTINCT
        wm.well_id,
        wm.rig_off_date,
        wm.flaf_issue_date,
        wm.rig_on_date,
        wm.kpi_miss_reason,
        wm.eng_completion_date,
        wm.well_type_id,
        wm.scr_date,
        wm.hoist_off_date,
        wm.wellpad_handover_date,
        wm.ipm,
        wm.cluster_code

    FROM well.well_master wm

    LEFT JOIN ref.cluster cl
        ON wm.cluster_code = cl.cluster_code

    LEFT JOIN dbo.plant_description pd
        ON cl.cluster_name = pd.cluster


    WHERE
        (
            @cluster IS NULL
            OR cl.cluster_name = @cluster
        )

        AND
        (
            @plant IS NULL
            OR pd.plant_description = @plant
        )
),

WellData AS
(
    SELECT DISTINCT
        wm.well_id,
        wm.rig_off_date,
        wm.flaf_issue_date,
        wm.scr_date,
        wm.rig_on_date,
        wm.kpi_miss_reason,
        wm.eng_completion_date,
        wm.hoist_off_date,
        wm.wellpad_handover_date,
        wm.ipm,
        wct.completion_type

    FROM FWM wm

    LEFT JOIN well.well_progress wp
        ON wm.well_id = wp.well_id

    LEFT JOIN well.well_completion_type wct
        ON wp.well_completion_type_id =
           wct.well_completion_type_id
),

PlanWells AS
(
    SELECT DISTINCT
        s.well_id,

        TRY_CAST(s.earl_start_date AS DATE)
            AS expected_rig_on

    FROM dsq.drilling_sequence s

    INNER JOIN FWM wm
        ON s.well_id = wm.well_id


    WHERE
        s.earl_start_date IS NOT NULL

        AND TRY_CAST(s.earl_start_date AS DATE)
            BETWEEN @start_date
                AND @end_date
),

Periods AS
(
    SELECT
        fp.period_label,
        fp.period_end,
        fp.seq

    FROM dbo.fn_GetPeriods
    (
        @start_date,
        @end_date,
        @mode
    ) fp

    WHERE @mode IN
    (
        'weekly',
        'monthly'
    )


    UNION ALL


    SELECT
        'Total' AS period_label,
        @end_date AS period_end,
        1 AS seq
    WHERE @mode = 'total'
),

PlanPeriod AS
(
    SELECT DISTINCT
        p.seq,
        p.period_label,
        p.period_end,
        w.well_id,
        w.expected_rig_on

    FROM Periods p

    INNER JOIN PlanWells w
        ON 1 = 1


    WHERE
        w.expected_rig_on
            BETWEEN @start_date
                AND p.period_end
),

DrilledWells AS
(
    SELECT DISTINCT
        p.seq,
        p.well_id

    FROM PlanPeriod p

    INNER JOIN FWM w
        ON p.well_id = w.well_id


    WHERE
        TRY_CAST(w.rig_off_date AS DATE)
            BETWEEN @start_date
                AND p.period_end
),

NotDrilledWells AS
(
    SELECT DISTINCT
        p.seq,
        p.well_id

    FROM PlanPeriod p

    WHERE NOT EXISTS
    (
        SELECT 1

        FROM DrilledWells d

        WHERE d.seq = p.seq
          AND d.well_id = p.well_id
    )
),

FLAFDelayWells AS
(
    SELECT DISTINCT
        p.seq,
        p.well_id

    FROM PlanPeriod p

    INNER JOIN WellData w
        ON p.well_id = w.well_id

    WHERE
        w.flaf_issue_date IS NOT NULL

        AND DATEDIFF
        (
            DAY,
            TRY_CAST(w.flaf_issue_date AS DATE),
            p.expected_rig_on
        ) < 90
),

SCRDelayWells AS
(
    SELECT DISTINCT
        p.seq,
        p.well_id

    FROM PlanPeriod p

    INNER JOIN WellData w
        ON p.well_id = w.well_id

    WHERE
        w.scr_date IS NOT NULL

        AND DATEDIFF
        (
            DAY,
            TRY_CAST(w.scr_date AS DATE),
            p.expected_rig_on
        ) < 90
),

DateNotDueWells AS
(
    SELECT DISTINCT
        p.seq,
        p.well_id

    FROM PlanPeriod p

    INNER JOIN WellData w
        ON p.well_id = w.well_id


    CROSS APPLY
    (
        SELECT
            MAX(v) AS latest_date

        FROM
        (
            VALUES
                (TRY_CAST(w.rig_off_date AS DATE)),
                (TRY_CAST(w.hoist_off_date AS DATE)),
                (TRY_CAST(w.wellpad_handover_date AS DATE))
        ) d(v)
    ) ld

    WHERE
        TRY_CAST(w.rig_off_date AS DATE)
            BETWEEN @start_date
                AND p.period_end

        AND ld.latest_date IS NOT NULL

        AND
        (
            (
                w.ipm IS NOT NULL

                AND DATEADD
                (
                    DAY,
                    4,
                    ld.latest_date
                ) > p.period_end
            )

            OR

            (
                w.ipm IS NULL

                AND w.completion_type IN
                (
                    'RSR',
                    'DWI'
                )

                AND DATEADD
                (
                    DAY,
                    80,
                    ld.latest_date
                ) > p.period_end
            )

            OR

            (
                w.ipm IS NULL

                AND
                (
                    w.completion_type NOT IN
                    (
                        'RSR',
                        'DWI'
                    )

                    OR w.completion_type IS NULL
                )

                AND DATEADD
                (
                    DAY,
                    2,
                    ld.latest_date
                ) > p.period_end
            )
        )
),

PDOIssueWells AS
(
    SELECT DISTINCT
        p.seq,
        p.well_id

    FROM PlanPeriod p

    INNER JOIN FWM w
        ON p.well_id = w.well_id

    WHERE
           w.kpi_miss_reason LIKE '%awaiting handover%'
        OR w.kpi_miss_reason LIKE '%awaiting manifold%'
        OR w.kpi_miss_reason LIKE '%msv%'
        OR w.kpi_miss_reason LIKE '%material availability%'
        OR w.kpi_miss_reason LIKE '%rsr%'
        OR w.kpi_miss_reason LIKE '%hoist delay%'
        OR w.kpi_miss_reason LIKE '%scope change%'
        OR w.kpi_miss_reason LIKE '%operation issue%'
        OR w.kpi_miss_reason LIKE '%appraisal well%'
        OR w.kpi_miss_reason LIKE '%technical issue%'
        OR w.kpi_miss_reason LIKE '%MOC%'
        OR w.kpi_miss_reason LIKE '%EMOC%'
),

SuspendedWells AS
(
    SELECT DISTINCT
        p.seq,
        p.well_id

    FROM PlanPeriod p

    INNER JOIN FWM w
        ON p.well_id = w.well_id

    WHERE
           w.kpi_miss_reason LIKE '%Well Suspended%'
        OR w.kpi_miss_reason LIKE '%Suspended%'
),

AllExcludedWells AS
(
    SELECT
        seq,
        well_id
    FROM NotDrilledWells

    UNION

    SELECT
        seq,
        well_id
    FROM FLAFDelayWells

    UNION

    SELECT
        seq,
        well_id
    FROM SCRDelayWells

    UNION

    SELECT
        seq,
        well_id
    FROM DateNotDueWells

    UNION

    SELECT
        seq,
        well_id
    FROM PDOIssueWells

    UNION

    SELECT
        seq,
        well_id
    FROM SuspendedWells
),

PlanDueWells AS
(
    SELECT DISTINCT
        p.seq,
        p.well_id

    FROM PlanPeriod p

    WHERE NOT EXISTS
    (
        SELECT 1

        FROM AllExcludedWells e

        WHERE e.seq = p.seq
          AND e.well_id = p.well_id
    )
),

ActualCompleted AS
(
    SELECT DISTINCT
        p.seq,
        w.well_id

    FROM Periods p

    INNER JOIN FWM w
        ON 1 = 1


    WHERE
        w.eng_completion_date IS NOT NULL

        AND TRY_CAST
        (
            w.eng_completion_date
            AS DATE
        )
        BETWEEN @start_date
            AND p.period_end
),

Metrics AS
(
    SELECT
        p.seq,
        p.period_label,

        (
            SELECT COUNT(DISTINCT x.well_id)
            FROM PlanPeriod x
            WHERE x.seq = p.seq
        ) AS plan_rig_seq,

        (
            SELECT COUNT(DISTINCT x.well_id)
            FROM NotDrilledWells x
            WHERE x.seq = p.seq
        ) AS not_drilled,

        (
            SELECT COUNT(DISTINCT x.well_id)
            FROM FLAFDelayWells x
            WHERE x.seq = p.seq
        ) AS excl_flaf,

        (
            SELECT COUNT(DISTINCT x.well_id)
            FROM SCRDelayWells x
            WHERE x.seq = p.seq
        ) AS excl_scr,

        (
            SELECT COUNT(DISTINCT x.well_id)
            FROM DateNotDueWells x
            WHERE x.seq = p.seq
        ) AS date_not_due,

        (
            SELECT COUNT(DISTINCT x.well_id)
            FROM PDOIssueWells x
            WHERE x.seq = p.seq
        ) AS pdo_issues,

        (
            SELECT COUNT(DISTINCT x.well_id)
            FROM SuspendedWells x
            WHERE x.seq = p.seq
        ) AS suspended,

        (
            SELECT COUNT(DISTINCT x.well_id)
            FROM PlanDueWells x
            WHERE x.seq = p.seq
        ) AS plan_due,

        (
            SELECT COUNT(DISTINCT x.well_id)
            FROM ActualCompleted x
            WHERE x.seq = p.seq
        ) AS actual_completed

    FROM Periods p
),

FinalMetrics AS
(
    SELECT
        seq,
        period_label,
        plan_rig_seq,
        not_drilled,
        excl_flaf,
        excl_scr,
        date_not_due,
        pdo_issues,
        suspended,
        plan_due,
        actual_completed,

        actual_completed - plan_due
            AS shortfall_excess

    FROM Metrics
)

SELECT
    m.period_label AS [Period],
    v.Category,
    v.Value

FROM FinalMetrics m

CROSS APPLY
(
    VALUES
        (
            1,
            'Plan - As per Rig Sequence',
            m.plan_rig_seq
        ),
        (
            2,
            'Not Drilled - Not Due',
            m.not_drilled
        ),
        (
            3,
            'Excluded - FLAF Delays',
            m.excl_flaf
        ),
        (
            4,
            'Excluded - SCR Delays',
            m.excl_scr
        ),
        (
            5,
            'Date is Not Due',
            m.date_not_due
        ),
        (
            6,
            'Issues to be Resolved by PDO',
            m.pdo_issues
        ),
        (
            7,
            'Wells Suspended',
            m.suspended
        ),
        (
            8,
            'Plan - Due Wells',
            m.plan_due
        ),
        (
            9,
            'Actual - Wells Completed',
            m.actual_completed
        ),
        (
            10,
            'Shortfall(-) / Excess(+)',
            m.shortfall_excess
        )
) v
(
    sort_order,
    Category,
    Value
)

ORDER BY
    m.seq,
    v.sort_order;