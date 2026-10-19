"""
Operational insights from the cleaned data — read-only, nothing is written.

  plan_realism       planned vs actual: hook-up vs the 2-day rule, drilling time
                     and rig-on slip per rig (PDO schedule snapshots), and actual
                     daily rates per activity next to dbo.activity_codes_norms
  crew_productivity  output per manhour per crew, compared with the typical crew
                     on the same activity and unit; output by crew size
  idle_days          days with hours booked but no output, per well, crew and month

Quantities are only compared within one activity and unit of measure.
"""
import numpy as np
import pandas as pd

from app.data import CleanData

HOOKUP_RULE_DAYS = 2
MIN_DAYS = 10                 # working days needed before a crew / activity is rated
MIN_ACTIVITY_DAYS = 20        # an activity needs this many days to define a "typical" day
INDEX_CLIP = (0.1, 10.0)      # one odd day cannot dominate a crew's index


def _work(data: CleanData) -> pd.DataFrame:
    """Clean working days with manhours (hours x people)."""
    d = data.daily.copy()
    d["manhours"] = d["hours_clean"] * d["crew_size"].clip(lower=1)
    return d


def plan_realism(data: CleanData) -> dict:
    m = data.master
    done = m[m["eng_completion_date"].notna() & m["rig_off_date"].notna()]
    hook = (done["eng_completion_date"] - done["rig_off_date"]).dt.days
    hook = hook[hook >= 0]
    by_month = (pd.DataFrame({"month": done.loc[hook.index, "eng_completion_date"].dt.to_period("M").astype(str), "days": hook})
                .groupby("month")["days"].agg(wells="size", median_days="median",
                                              within_rule=lambda s: round(float((s <= HOOKUP_RULE_DAYS).mean()), 2))
                .reset_index())

    # Drilling time and rig-on slip per rig, against the first PDO schedule that listed the well.
    pdo = data.pdo.dropna(subset=["earl_start_date"]).sort_values("load_timestamp")
    first_plan = pdo.groupby("well_id").first()
    drill = m[m["rig_on_date"].notna() & m["rig_off_date"].notna()].set_index("well_id")
    rig = drill.join(first_plan[["earl_start_date", "earl_end_date", "normal_duration", "pdo_rig_id"]], how="inner")
    rig = rig[rig["rig_on_date"] >= first_plan["load_timestamp"].reindex(rig.index)]   # plan made before the rig came
    rig["actual_drilling_days"] = (rig["rig_off_date"] - rig["rig_on_date"]).dt.days
    rig["rig_on_slip_days"] = (rig["rig_on_date"] - rig["earl_start_date"]).dt.days      # + = later than PDO plan
    rig["drilling_overrun_days"] = rig["actual_drilling_days"] - rig["normal_duration"]
    per_rig = (rig.groupby("pdo_rig_id")
                  .agg(wells=("actual_drilling_days", "size"),
                       planned_drilling_days=("normal_duration", "median"),
                       actual_drilling_days=("actual_drilling_days", "median"),
                       rig_on_slip_days=("rig_on_slip_days", "median"),
                       share_rig_on_late=("rig_on_slip_days", lambda s: round(float((s > 0).mean()), 2)))
                  .query("wells >= 3").sort_values("rig_on_slip_days", ascending=False).reset_index()
                  .rename(columns={"pdo_rig_id": "rig_id"}))

    # Actual daily rate per activity + unit, next to the activity norm.
    w = _work(data)
    w = w[w["qty_clean"] > 0]
    act = (w.groupby(["activity", "uom_id"])
            .agg(working_days=("qty_clean", "size"), wells=("well_id", "nunique"),
                 median_daily_qty=("qty_clean", "median"),
                 p25_daily_qty=("qty_clean", lambda s: s.quantile(0.25)),
                 p75_daily_qty=("qty_clean", lambda s: s.quantile(0.75)),
                 qty_per_manhour=("qty_clean", "sum"), manhours=("manhours", "sum"))
            .reset_index())
    act["qty_per_manhour"] = (act["qty_per_manhour"] / act["manhours"].replace(0, np.nan)).round(3)
    act = act.drop(columns="manhours")
    act = act[act["working_days"] >= MIN_DAYS].sort_values("working_days", ascending=False)

    return {
        "hookup": {
            "rule_days": HOOKUP_RULE_DAYS, "wells": int(len(hook)), "median_days": float(hook.median()),
            "p90_days": float(hook.quantile(0.9)), "share_within_rule": round(float((hook <= HOOKUP_RULE_DAYS).mean()), 2),
            "by_month": by_month.to_dict("records"),
        },
        "rigs": {
            "wells_compared": int(len(rig)),
            "median_rig_on_slip_days": float(rig["rig_on_slip_days"].median()) if len(rig) else None,
            "share_rig_on_late": round(float((rig["rig_on_slip_days"] > 0).mean()), 2) if len(rig) else None,
            "median_drilling_overrun_days": float(rig["drilling_overrun_days"].median()) if len(rig) else None,
            "per_rig": per_rig.round(1).to_dict("records"),
        },
        "activities": act.round(2).to_dict("records"),
    }


def crew_productivity(data: CleanData) -> dict:
    """Crew index = the crew's output on a day divided by the typical (median)
    daily output on that activity and unit, then the crew's median over its
    days; 1.2 = 20% more output than a typical crew on the same work.

    Output per day is used rather than per manhour: many reports list only the
    supervisor in employee_ids, so manhours are understated and unreliable."""
    w = _work(data)
    w = w[w["qty_clean"] > 0].copy()
    days = w.groupby(["activity", "uom_id"])["qty_clean"].transform("size")
    w["typical"] = w.groupby(["activity", "uom_id"])["qty_clean"].transform("median")
    w = w[days >= MIN_ACTIVITY_DAYS]
    w["rate"] = w["qty_clean"]
    w["index"] = (w["qty_clean"] / w["typical"]).clip(INDEX_CLIP[0], INDEX_CLIP[1])
    named = w[w["crew_id"].notna()].merge(data.crews, on="crew_id", how="left")
    named["at_or_above_typical"] = named["index"] >= 1
    crews = (named.groupby(["crew_id", "crew_code", "crew_type_name"], dropna=False)
                  .agg(working_days=("index", "size"), wells=("well_id", "nunique"), activities=("activity", "nunique"),
                       productivity_index=("index", "median"), consistency=("at_or_above_typical", "mean"),
                       avg_crew_size=("crew_size", "mean"), manhours=("manhours", "sum"))
                  .reset_index())
    crews = crews[crews["working_days"] >= MIN_DAYS].sort_values("productivity_index", ascending=False)
    crews["crew_id"] = crews["crew_id"].astype(int)

    # Idle share per crew (days with hours booked but no output), for the scorecard.
    booked = _work(data)
    booked = booked[(booked["hours_clean"] > 0) & booked["crew_id"].notna()]
    idle_share = (booked.assign(idle=booked["qty"].fillna(0) <= 0)
                        .groupby("crew_id")["idle"].mean().rename("idle_share"))
    crews = crews.join(idle_share, on="crew_id")
    crews["rank"] = crews["productivity_index"].rank(ascending=False, method="min").astype(int)
    crews["rank_in_type"] = (crews.groupby("crew_type_name", dropna=False)["productivity_index"]
                                  .rank(ascending=False, method="min").astype(int))

    # Crew types: how the crews of each type compare.
    types = (crews.groupby("crew_type_name", dropna=False)
                  .agg(crews=("crew_id", "size"), working_days=("working_days", "sum"),
                       median_index=("productivity_index", "median"),
                       best_index=("productivity_index", "max"), worst_index=("productivity_index", "min"),
                       spread=("productivity_index", lambda s: s.quantile(0.9) / max(s.quantile(0.1), 0.01)),
                       idle_share=("idle_share", "median"))
                  .query("crews >= 3").sort_values("working_days", ascending=False).reset_index())

    # Best crews on each of the busiest activities.
    per_act = (named.groupby(["activity", "uom_id", "crew_id", "crew_code"], dropna=False)
                    .agg(days=("index", "size"), index=("index", "median")).reset_index())
    per_act = per_act[per_act["days"] >= 5]
    busiest = named.groupby(["activity", "uom_id"]).size().sort_values(ascending=False).head(12).index
    best = (per_act.set_index(["activity", "uom_id"]).loc[per_act.set_index(["activity", "uom_id"]).index.isin(busiest)]
                   .reset_index().sort_values(["activity", "index"], ascending=[True, False])
                   .groupby(["activity", "uom_id"]).head(3))
    best["crew_id"] = best["crew_id"].astype(int)

    # Does a bigger crew deliver more? Median output per day by crew size, busiest activities.
    top = w.groupby(["activity", "uom_id"]).size().sort_values(ascending=False).head(8).index
    size = (w.set_index(["activity", "uom_id"]).loc[top].reset_index()
             .assign(crew_size=lambda d: d["crew_size"].clip(upper=8))
             .groupby(["activity", "uom_id", "crew_size"])
             .agg(days=("qty_clean", "size"), median_daily_qty=("qty_clean", "median"))
             .reset_index())
    size = size[size["days"] >= 5]
    return {
        "crews_rated": int(len(crews)), "days_with_crew_id": int(w["crew_id"].notna().sum()), "days_total": int(len(w)),
        "crews": crews.round(2).to_dict("records"),
        "crew_types": types.round(2).to_dict("records"),
        "best_per_activity": best.round(2).to_dict("records"),
        "crew_size": size.round(2).to_dict("records"),
        "note": ("Only daily reports with a crew_id can be credited to a crew (about half of working days). "
                 "Index 1.0 = typical daily output on the same activity; crew size comes from employee_ids, "
                 "which often lists only the supervisor."),
    }


def idle_days(data: CleanData, stalled_wells: pd.DataFrame | None = None) -> dict:
    """Idle day = hours were booked but no output was reported.

    Uses the reported quantity, not qty_clean: a day whose quantity was flagged
    as an outlier (e.g. a typo) did have output, so it is not idle."""
    w = _work(data)
    booked = w[w["hours_clean"] > 0]
    booked = booked.assign(idle=(booked["qty"].fillna(0) <= 0))
    per_well = (booked.groupby("well_id")
                      .agg(booked_days=("idle", "size"), idle_days=("idle", "sum"),
                           idle_manhours=("manhours", lambda s: float(s[booked.loc[s.index, "idle"]].sum())))
                      .assign(idle_share=lambda d: (d["idle_days"] / d["booked_days"]).round(2))
                      .query("idle_days > 0").sort_values("idle_manhours", ascending=False).reset_index())
    idle = booked[booked["idle"]]
    by_crew = (idle[idle["crew_id"].notna()].merge(data.crews, on="crew_id", how="left")
                   .groupby(["crew_id", "crew_code", "crew_type_name"], dropna=False)
                   .agg(idle_days=("idle", "size"), idle_manhours=("manhours", "sum"), wells=("well_id", "nunique"))
                   .sort_values("idle_manhours", ascending=False).reset_index())
    by_crew["crew_id"] = by_crew["crew_id"].astype(int)
    by_activity = (idle.groupby("activity").agg(idle_days=("idle", "size"), idle_manhours=("manhours", "sum"))
                       .sort_values("idle_manhours", ascending=False).head(25).reset_index())
    named_idle = idle[idle["crew_id"].notna()].merge(data.crews, on="crew_id", how="left")
    by_crew_type = (named_idle.groupby("crew_type_name", dropna=False)
                              .agg(idle_days=("idle", "size"), idle_manhours=("manhours", "sum"), crews=("crew_id", "nunique"))
                              .sort_values("idle_manhours", ascending=False).head(20).reset_index())
    by_person = (idle[idle["ph_name"].notna()].groupby("ph_name")
                     .agg(idle_days=("idle", "size"), idle_manhours=("manhours", "sum"), wells=("well_id", "nunique"))
                     .join(booked[booked["ph_name"].notna()].groupby("ph_name").size().rename("booked_days"))
                     .assign(idle_share=lambda d: d["idle_days"] / d["booked_days"])
                     .query("booked_days >= 20").sort_values("idle_manhours", ascending=False).head(25).reset_index()
                     .rename(columns={"ph_name": "person_in_charge"}))
    by_weekday = (booked.assign(weekday=booked["ds"].dt.day_name())
                        .groupby("weekday").agg(booked_days=("idle", "size"), idle_days=("idle", "sum"))
                        .assign(idle_share=lambda d: d["idle_days"] / d["booked_days"])
                        .reindex(["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])
                        .dropna().reset_index())

    # Runs of idle days on the same well: a run of 2+ days usually means a holdup
    # (waiting for material, equipment or a permit) rather than a slow day.
    wd = booked.groupby(["well_id", "ds"])["idle"].all().reset_index().sort_values(["well_id", "ds"])
    breaks = ((wd["well_id"] != wd["well_id"].shift()) | (wd["ds"].diff().dt.days != 1)
              | (wd["idle"] != wd["idle"].shift()))
    wd["run"] = breaks.cumsum()
    runs = (wd[wd["idle"]].groupby(["well_id", "run"])
                          .agg(start=("ds", "min"), end=("ds", "max"), idle_days=("ds", "size")).reset_index())
    runs = runs[runs["idle_days"] >= 2].sort_values("idle_days", ascending=False).drop(columns="run")

    by_month = (booked.assign(month=booked["ds"].dt.to_period("M").astype(str))
                      .groupby("month").agg(booked_days=("idle", "size"), idle_days=("idle", "sum"),
                                            idle_manhours=("manhours", lambda s: float(s[booked.loc[s.index, "idle"]].sum())))
                      .assign(idle_share=lambda d: (d["idle_days"] / d["booked_days"]).round(3)).reset_index())
    out = {
        "booked_days": int(len(booked)), "idle_days": int(booked["idle"].sum()),
        "idle_manhours": round(float(idle["manhours"].sum()), 0),
        "idle_share": round(float(booked["idle"].mean()), 3),
        "by_month": by_month.round({"idle_manhours": 1}).to_dict("records"),
        "wells": per_well.head(100).round(1).to_dict("records"),
        "crews": by_crew.head(50).round(1).to_dict("records"),
        "activities": by_activity.round(1).to_dict("records"),
        "crew_types": by_crew_type.round(1).to_dict("records"),
        "people": by_person.round(3).to_dict("records"),
        "weekdays": by_weekday.round(3).to_dict("records"),
        "idle_runs": runs.head(40).assign(start=lambda d: d["start"].dt.date.astype(str),
                                          end=lambda d: d["end"].dt.date.astype(str)).to_dict("records"),
        "idle_runs_count": int(len(runs)),
    }
    if stalled_wells is not None and len(stalled_wells):
        cols = ["well_id", "stage", "risk", "kpi_miss_reason", "actual_rig_off", "days_since_work", "flag"]
        out["stalled_wells"] = stalled_wells[cols].to_dict("records")
    return out
