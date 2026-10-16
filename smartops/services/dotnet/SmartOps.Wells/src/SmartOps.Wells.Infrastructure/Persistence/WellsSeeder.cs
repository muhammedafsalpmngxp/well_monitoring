using SmartOps.Wells.Domain.Entities;
using SmartOps.Wells.Infrastructure.Persistence;

namespace SmartOps.Wells.Infrastructure.Persistence;

/// <summary>
/// Seeds reference data for local / dev environments.
/// Seeding is skipped when the DB already contains data (idempotent).
/// Production: seeding is disabled when pointing to remote AppMasterDB.
/// </summary>
public static class WellsSeeder
{
    public static async Task SeedAsync(WellsDbContext db)
    {
        await db.Database.EnsureCreatedAsync();

        if (!db.Clusters.Any())
        {
            db.Clusters.AddRange(
                new() { Key = "NIMR",    Name = "NIMR Cluster",    Total = 10, Ready = 7, Pct = 70.0, Color = "#2563eb" },
                new() { Key = "AL BURJ", Name = "AL BURJ Cluster", Total = 10, Ready = 9, Pct = 90.0, Color = "#f97316" },
                new() { Key = "AMIN",    Name = "AMIN Cluster",    Total = 10, Ready = 6, Pct = 60.0, Color = "#16a34a" },
                new() { Key = "TUQAA",   Name = "TUQAA Cluster",   Total = 10, Ready = 8, Pct = 80.0, Color = "#eab308" },
                new() { Key = "RAKID",   Name = "RAKID Cluster",   Total = 10, Ready = 7, Pct = 70.0, Color = "#a855f7" }
            );
        }

        if (!db.Wells.Any())
        {
            db.Wells.AddRange(
                new() { WellId = "34565", Cluster = "NIMR",    Location = "NIMRB_1609240004_OP3",   WellType = "Oil Producer",   ActivityCode = "F-C-SLL-SSO-01", Activity = "Surveying & Setting out for Flow Line",            CrewGroup = "SSS-0401", Crew = "Survey - Survey",               Progress = 78, Planned = 75, RateDay = 8.4, AskRate = 7.1, RigOn = "Apr 28", Status = "On Track", Spi = 1.04, Cpi = 0.98 },
                new() { WellId = "34561", Cluster = "NIMR",    Location = "NIMRB_1609240004_OP6",   WellType = "Oil Producer",   ActivityCode = "F-C-SLL-GRA-01", Activity = "Flow line Route Grading",                          CrewGroup = "FCR-0303", Crew = "FlowLine · Civil · Grading",    Progress = 85, Planned = 80, RateDay = 9.6, AskRate = 8.2, RigOn = "Apr 25", Status = "Ahead",    Spi = 1.06, Cpi = 1.02 },
                new() { WellId = "31780", Cluster = "NIMR",    Location = "NIMRB_1609240004_OP1",   WellType = "Oil Producer",   ActivityCode = "F-C-SLL-UIA-01", Activity = "Sleeper Installation & Alignment",                  CrewGroup = "FCS-0402", Crew = "FlowLine · Civil · Sleeper",    Progress = 20, Planned = 55, RateDay = 2.4, AskRate = 7.5, RigOn = "May 12", Status = "Critical", Spi = 0.36, Cpi = 0.68 },
                new() { WellId = "36078", Cluster = "NIMR",    Location = "NIMRB_2205240002_AP1",   WellType = "Oil Producer",   ActivityCode = "F-C-FDI-EXC-01", Activity = "Foundation Excavation — Normal Soil",               CrewGroup = "FCG-0402", Crew = "FlowLine · Civil · General",    Progress = 65, Planned = 75, RateDay = 6.3, AskRate = 7.8, RigOn = "May 02", Status = "At Risk",  Spi = 0.87, Cpi = 0.92 },
                new() { WellId = "34422", Cluster = "AL BURJ", Location = "AL BURJ_26_MC_OP2",      WellType = "Oil Producer",   ActivityCode = "F-C-FDI-GRO-01", Activity = "Grouting for Structural Pipe Support",              CrewGroup = "FCO-0502", Crew = "FlowLine · Civil · Grouting",   Progress = 75, Planned = 73, RateDay = 7.9, AskRate = 7.2, RigOn = "Apr 30", Status = "On Track", Spi = 1.03, Cpi = 0.99 },
                new() { WellId = "37797", Cluster = "AL BURJ", Location = "AL BURJ_26_MC_OP3",      WellType = "Oil Producer",   ActivityCode = "F-C-RWE-PRP-03", Activity = "Pre Padding for Flowline Trench",                   CrewGroup = "FCP-0403", Crew = "FlowLine · Civil · Padding",    Progress = 82, Planned = 78, RateDay = 8.7, AskRate = 7.4, RigOn = "May 03", Status = "On Track", Spi = 1.05, Cpi = 1.01 },
                new() { WellId = "34357", Cluster = "AL BURJ", Location = "34561",                  WellType = "Oil Producer",   ActivityCode = "F-M-RWF-PWD-04", Activity = "RDX / Wadi Crossing — Welding Joints (4\")",        CrewGroup = "FWR-0602", Crew = "FlowLine · Welding · RDX",      Progress = 60, Planned = 70, RateDay = 6.1, AskRate = 7.5, RigOn = "May 08", Status = "At Risk",  Spi = 0.86, Cpi = 0.91 },
                new() { WellId = "24665", Cluster = "AL BURJ", Location = "31780",                  WellType = "Oil Producer",   ActivityCode = "F-M-RWF-PLR-04", Activity = "RDX / Wadi Crossing — Pipeline Lowering (4\")",     CrewGroup = "FWR-0803", Crew = "FlowLine · Welding · RDX",      Progress = 90, Planned = 84, RateDay = 10.4, AskRate = 8.6, RigOn = "Apr 26", Status = "Ahead",   Spi = 1.07, Cpi = 1.04 },
                new() { WellId = "30330", Cluster = "AMIN",    Location = "AMIN_3946610_OP11",      WellType = "Oil Producer",   ActivityCode = "F-M-PFW-CSW-04", Activity = "CS Pipe Welding (4\" dia)",                         CrewGroup = "FWP-0601", Crew = "FlowLine · Welding · Piping",   Progress = 48, Planned = 62, RateDay = 5.1, AskRate = 7.4, RigOn = "May 06", Status = "At Risk",  Spi = 0.77, Cpi = 0.88 },
                new() { WellId = "36076", Cluster = "AMIN",    Location = "AMIN_3946610_OP10",      WellType = "Oil Producer",   ActivityCode = "F-M-HFP-FUS-04", Activity = "HDPE Pipe Fusion & Pull (4\")",                     CrewGroup = "FHF-0501", Crew = "FlowLine · HDPE · Fusion",      Progress = 35, Planned = 65, RateDay = 3.2, AskRate = 8.0, RigOn = "May 10", Status = "Critical", Spi = 0.54, Cpi = 0.74 },
                new() { WellId = "36075", Cluster = "AMIN",    Location = "AMIN_1673188_OP21",      WellType = "Oil Producer",   ActivityCode = "F-M-HYD-TST-01", Activity = "Final Hydro Test of Flowline",                      CrewGroup = "FHT-0301", Crew = "FlowLine · Hydro · Testing",    Progress = 55, Planned = 53, RateDay = 6.0, AskRate = 7.6, RigOn = "May 14", Status = "On Track", Spi = 1.04, Cpi = 0.98 },
                new() { WellId = "36106", Cluster = "AMIN",    Location = "AMIN_1673188_OP31",      WellType = "Oil Producer",   ActivityCode = "F-E-OFE-CBL-01", Activity = "LV / Earth Cable Laying",                           CrewGroup = "FEC-0602", Crew = "FlowLine · Electrical · Cable", Progress = 58, Planned = 56, RateDay = 6.4, AskRate = 7.5, RigOn = "May 09", Status = "On Track", Spi = 1.04, Cpi = 0.99 },
                new() { WellId = "33146", Cluster = "TUQAA",   Location = "TUQAA_PH1_WI_LOC1",     WellType = "Water Injector", ActivityCode = "F-E-OFE-CBT-01", Activity = "LV Cable Glanding & Termination",                   CrewGroup = "FEL-0501", Crew = "FlowLine · Electrical · LV Term", Progress = 68, Planned = 65, RateDay = 7.1, AskRate = 7.0, RigOn = "May 04", Status = "On Track", Spi = 1.05, Cpi = 1.00 },
                new() { WellId = "33147", Cluster = "TUQAA",   Location = "TUQAA_PH1_WI_LOC2",     WellType = "Water Injector", ActivityCode = "F-E-OFE-TST-01", Activity = "LV Cable Testing",                                  CrewGroup = "FET-0501", Crew = "FlowLine · Electrical · Testing", Progress = 50, Planned = 60, RateDay = 5.4, AskRate = 7.0, RigOn = "May 18", Status = "At Risk",  Spi = 0.83, Cpi = 0.90 },
                new() { WellId = "33152", Cluster = "TUQAA",   Location = "TUQAA_PH1_OP_LOC11",    WellType = "Oil Producer",   ActivityCode = "F-I-ONI-CBL-01", Activity = "Instrument / Earth Cable Laying",                   CrewGroup = "FII-0502", Crew = "FlowLine · Instrumentation",    Progress = 40, Planned = 55, RateDay = 4.2, AskRate = 7.2, RigOn = "May 21", Status = "At Risk",  Spi = 0.73, Cpi = 0.86 },
                new() { WellId = "33153", Cluster = "TUQAA",   Location = "TUQAA_PH1_OP_LOC12",    WellType = "Oil Producer",   ActivityCode = "F-I-ONI-LPC-01", Activity = "Instrument Loop Check",                             CrewGroup = "FII-0502", Crew = "FlowLine · Instrumentation",    Progress = 58, Planned = 55, RateDay = 6.0, AskRate = 7.4, RigOn = "May 11", Status = "On Track", Spi = 1.05, Cpi = 1.01 },
                new() { WellId = "36748", Cluster = "RAKID",   Location = "RAKID_PHASE_C_OP_LOC14", WellType = "Oil Producer",  ActivityCode = "F-I-ONI-TST-01", Activity = "Instrument Calibration & Testing",                  CrewGroup = "FII-0502", Crew = "FlowLine · Instrumentation",    Progress = 55, Planned = 53, RateDay = 5.9, AskRate = 7.3, RigOn = "May 15", Status = "On Track", Spi = 1.04, Cpi = 0.99 },
                new() { WellId = "36749", Cluster = "RAKID",   Location = "RAKID_PHASE_C_OP_LOC15", WellType = "Oil Producer",  ActivityCode = "F-E-OHL-PER-01", Activity = "OHL Pole Erection",                                 CrewGroup = "FEO-0701", Crew = "FlowLine · OHL · Erection",     Progress = 70, Planned = 65, RateDay = 7.6, AskRate = 7.5, RigOn = "May 07", Status = "Ahead",    Spi = 1.08, Cpi = 1.03 },
                new() { WellId = "36757", Cluster = "RAKID",   Location = "RAKID_PHASE_C_WI_LOC1",  WellType = "Water Injector",ActivityCode = "F-E-OHL-CON-01", Activity = "OHL Conductor Stringing",                           CrewGroup = "FEO-0702", Crew = "FlowLine · OHL · Conductor",    Progress = 30, Planned = 60, RateDay = 2.9, AskRate = 7.0, RigOn = "May 20", Status = "Critical", Spi = 0.50, Cpi = 0.72 },
                new() { WellId = "36758", Cluster = "RAKID",   Location = "RAKID_PHASE_C_WI_LOC2",  WellType = "Water Injector",ActivityCode = "S-M-MIL-FLS-01", Activity = "Flowline Start (Milestone)",                        CrewGroup = "FRL-0502", Crew = "FlowLine · Rigging · Logistics", Progress = 25, Planned = 45, RateDay = 2.2, AskRate = 6.8, RigOn = "May 24", Status = "At Risk",  Spi = 0.56, Cpi = 0.78 },
                new() { WellId = "34566", Cluster = "NIMR",    Location = "NIMRB_1609240004_OP4",   WellType = "Oil Producer",   ActivityCode = "F-C-FDI-EXC-02", Activity = "Foundation Excavation — Hard Rock",                 CrewGroup = "FCG-0403", Crew = "FlowLine · Civil · Hard Rock",  Progress = 52, Planned = 65, RateDay = 5.4, AskRate = 7.5, RigOn = "May 06", Status = "At Risk",  Spi = 0.80, Cpi = 0.89 },
                new() { WellId = "24666", Cluster = "AL BURJ", Location = "AL BURJ_26_MC_OP4",      WellType = "Oil Producer",   ActivityCode = "F-M-PFW-CSW-06", Activity = "CS Pipe Welding (6\" dia)",                         CrewGroup = "FWP-0701", Crew = "FlowLine · Welding · Piping",   Progress = 74, Planned = 71, RateDay = 7.7, AskRate = 7.3, RigOn = "May 01", Status = "On Track", Spi = 1.04, Cpi = 0.99 },
                new() { WellId = "36077", Cluster = "AMIN",    Location = "AMIN_3946610_OP12",      WellType = "Oil Producer",   ActivityCode = "F-E-OFE-LPC-01", Activity = "Loop Check & Energisation",                         CrewGroup = "FEC-0603", Crew = "FlowLine · Electrical · Loop",  Progress = 88, Planned = 82, RateDay = 9.4, AskRate = 8.2, RigOn = "Apr 30", Status = "Ahead",    Spi = 1.07, Cpi = 1.03 },
                new() { WellId = "33148", Cluster = "TUQAA",   Location = "TUQAA_PH1_WI_LOC3",     WellType = "Water Injector", ActivityCode = "F-I-ONI-CAL-02", Activity = "Instrument Calibration & FAT",                      CrewGroup = "FII-0503", Crew = "FlowLine · Instrumentation · FAT", Progress = 62, Planned = 60, RateDay = 6.8, AskRate = 7.0, RigOn = "May 13", Status = "On Track", Spi = 1.03, Cpi = 0.97 },
                new() { WellId = "36750", Cluster = "RAKID",   Location = "RAKID_PHASE_C_OP_LOC16", WellType = "Oil Producer",  ActivityCode = "F-C-RWE-PRP-04", Activity = "Pre-Padding & Compaction",                          CrewGroup = "FCP-0404", Crew = "FlowLine · Civil · Padding",    Progress = 28, Planned = 62, RateDay = 2.7, AskRate = 7.6, RigOn = "May 22", Status = "Critical", Spi = 0.45, Cpi = 0.70 },
                new() { WellId = "33154", Cluster = "TUQAA",   Location = "TUQAA_PH1_OP_LOC13",    WellType = "Oil Producer",   ActivityCode = "F-M-HYD-TST-02", Activity = "Final Hydro Test of Flowline",                      CrewGroup = "FHT-0302", Crew = "FlowLine · Hydro · Testing",    Progress = 46, Planned = 58, RateDay = 5.0, AskRate = 7.2, RigOn = "May 17", Status = "At Risk",  Spi = 0.79, Cpi = 0.88 }
            );
        }

        if (!db.Milestones.Any())
        {
            DateOnly? D(string? s) => string.IsNullOrEmpty(s) ? null : DateOnly.Parse(s);
            db.Milestones.AddRange(
                new() { WellId = "37797", Name = "Flowline Start",      Owner = "Khalid Al-Balushi", Planned = D("2026-03-09"), Forecast = D("2026-04-29"), VarDays = 51,  Status = "overdue"  },
                new() { WellId = "31780", Name = "Flowline Start",      Owner = "Khalid Al-Balushi", Planned = D("2026-03-16"), Forecast = D("2026-04-29"), VarDays = 44,  Status = "overdue"  },
                new() { WellId = "31780", Name = "Flowline Finish",     Owner = "Salim Al-Zaabi",    Planned = D("2026-04-13"), Forecast = D("2026-05-20"), VarDays = 37,  Status = "overdue"  },
                new() { WellId = "37797", Name = "Flowline Finish",     Owner = "Salim Al-Zaabi",    Planned = D("2026-04-20"), Forecast = D("2026-05-15"), VarDays = 25,  Status = "overdue"  },
                new() { WellId = "34561", Name = "Flowline Start",      Owner = "Khalid Al-Balushi", Planned = D("2026-03-23"), Actual   = D("2026-03-23"), VarDays = 0,   Status = "done"     },
                new() { WellId = "34561", Name = "Flowline Finish",     Owner = "Salim Al-Zaabi",    Planned = D("2026-04-27"), Forecast = D("2026-04-30"), VarDays = 3,   Status = "critical" },
                new() { WellId = "34565", Name = "Hook Up Finish",      Owner = "Ahmed Al-Rashdi",   Planned = D("2026-04-26"), Actual   = D("2026-04-26"), VarDays = 0,   Status = "done"     },
                new() { WellId = "33153", Name = "Hook Up Finish",      Owner = "Ahmed Al-Rashdi",   Planned = D("2026-04-22"), Actual   = D("2026-04-22"), VarDays = 0,   Status = "done"     },
                new() { WellId = "36106", Name = "Hook Up Finish",      Owner = "Ahmed Al-Rashdi",   Planned = D("2026-05-03"), Forecast = D("2026-05-03"), VarDays = -4,  Status = "upcoming" },
                new() { WellId = "34357", Name = "Construction Finish", Owner = "Ahmed Al-Rashdi",   Planned = D("2026-04-09"), Forecast = D("2026-04-27"), VarDays = 18,  Status = "overdue"  },
                new() { WellId = "34561", Name = "Construction Start",  Owner = "Badr Al-Hinai",     Planned = D("2026-04-08"), Forecast = D("2026-04-27"), VarDays = 19,  Status = "overdue"  },
                new() { WellId = "24665", Name = "Construction Start",  Owner = "Khalid Al-Balushi", Planned = D("2026-04-08"), Forecast = D("2026-04-27"), VarDays = 19,  Status = "overdue"  },
                new() { WellId = "36106", Name = "RIG-ON",              Owner = "PDO Operations",    Planned = D("2026-04-17"), Forecast = D("2026-04-27"), VarDays = 10,  Status = "overdue"  },
                new() { WellId = "36106", Name = "Rig-Off",             Owner = "PDO Operations",    Planned = D("2026-04-25"), Forecast = D("2026-04-27"), VarDays = 2,   Status = "critical" },
                new() { WellId = "37797", Name = "Final Closeout",      Owner = "Salim Al-Zaabi",    Planned = D("2026-04-26"), Forecast = D("2026-04-28"), VarDays = 1,   Status = "critical" },
                new() { WellId = "34561", Name = "Construction Finish", Owner = "Ahmed Al-Rashdi",   Planned = D("2026-04-29"), Forecast = D("2026-04-27"), VarDays = -2,  Status = "upcoming" },
                new() { WellId = "34357", Name = "RIG-ON",              Owner = "PDO Operations",    Planned = D("2026-05-06"), Forecast = D("2026-04-27"), VarDays = -9,  Status = "upcoming" },
                new() { WellId = "34565", Name = "Construction Finish", Owner = "Ahmed Al-Rashdi",   Planned = D("2026-04-19"), Actual   = D("2026-04-19"), VarDays = 0,   Status = "done"     },
                new() { WellId = "34422", Name = "Rig-Off",             Owner = "PDO Operations",    Planned = D("2026-03-18"), Actual   = D("2026-03-18"), VarDays = 0,   Status = "done"     }
            );
        }

        await db.SaveChangesAsync();
    }
}
