using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Delivery;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Infrastructure.Persistence;

public class TenantDbContext(DbContextOptions<TenantDbContext> options) : DbContext(options)
{
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Dashboard> Dashboards => Set<Dashboard>();
    public DbSet<ChartLibrary> ChartLibrary => Set<ChartLibrary>();
    public DbSet<Report> Reports => Set<Report>();
    public DbSet<ReportTemplate> ReportTemplates => Set<ReportTemplate>();
    public DbSet<LearnVideo> LearnVideos => Set<LearnVideo>();
    public DbSet<Widget> Widgets => Set<Widget>();
    public DbSet<UserPreference> UserPreferences => Set<UserPreference>();
    public DbSet<DashboardSavedFilter> DashboardSavedFilters => Set<DashboardSavedFilter>();
    public DbSet<DatabaseConnection> DatabaseConnections => Set<DatabaseConnection>();
    public DbSet<DatabaseSchema> DatabaseSchemas => Set<DatabaseSchema>();
    public DbSet<DatabaseView> DatabaseViews => Set<DatabaseView>();
    public DbSet<CrewActivityAssignment> CrewActivityAssignments => Set<CrewActivityAssignment>();
    public DbSet<DataRule> DataRules => Set<DataRule>();
    public DbSet<ErrorLog> ErrorLogs => Set<ErrorLog>();
    public DbSet<Comment> Comments => Set<Comment>();
    public DbSet<ImportedDataset> ImportedDatasets => Set<ImportedDataset>();
    public DbSet<ImportedDataRow> ImportedDataRows => Set<ImportedDataRow>();
    public DbSet<AiSettings> AiSettings => Set<AiSettings>();
    public DbSet<AiProvider> AiProviders => Set<AiProvider>();
    public DbSet<AiFeatureQuery> AiFeatureQueries => Set<AiFeatureQuery>();
    public DbSet<AiFeatureAnswer> AiFeatureAnswers => Set<AiFeatureAnswer>();
    public DbSet<AiFeatureJob> AiFeatureJobs => Set<AiFeatureJob>();
    public DbSet<AnomalyRule> AnomalyRules => Set<AnomalyRule>();
    public DbSet<AnomalyProbe> AnomalyProbes => Set<AnomalyProbe>();
    public DbSet<AnomalyRun> AnomalyRuns => Set<AnomalyRun>();
    public DbSet<AnomalyRunReport> AnomalyRunReports => Set<AnomalyRunReport>();
    public DbSet<AnomalyProposal> AnomalyProposals => Set<AnomalyProposal>();
    public DbSet<AiFeatureRole> AiFeatureRoles => Set<AiFeatureRole>();
    public DbSet<AiUsageLog> AiUsageLogs => Set<AiUsageLog>();
    public DbSet<AiConversation> AiConversations => Set<AiConversation>();
    public DbSet<AiChatMessage> AiChatMessages => Set<AiChatMessage>();
    public DbSet<AiTrace> AiTraces => Set<AiTrace>();
    public DbSet<AiAlert> AiAlerts => Set<AiAlert>();
    public DbSet<AiAgent> AiAgents => Set<AiAgent>();
    public DbSet<AiModelPrice> AiModelPrices => Set<AiModelPrice>();
    public DbSet<AiAgentRun> AiAgentRuns => Set<AiAgentRun>();
    public DbSet<AiAgentVersion> AiAgentVersions => Set<AiAgentVersion>();
    public DbSet<AiAgentMemory> AiAgentMemories => Set<AiAgentMemory>();
    public DbSet<AiAgentSchedule> AiAgentSchedules => Set<AiAgentSchedule>();
    public DbSet<AiAgentEvalCase> AiAgentEvalCases => Set<AiAgentEvalCase>();
    public DbSet<AiAgentEvalRun> AiAgentEvalRuns => Set<AiAgentEvalRun>();
    public DbSet<AiDatasetNote> AiDatasetNotes => Set<AiDatasetNote>();
    public DbSet<AiDatasetPrompt> AiDatasetPrompts => Set<AiDatasetPrompt>();
    public DbSet<AiDatasetRelation> AiDatasetRelations => Set<AiDatasetRelation>();
    public DbSet<AiExample> AiExamples => Set<AiExample>();
    public DbSet<AiNoteProposal> AiNoteProposals => Set<AiNoteProposal>();
    public DbSet<AiMetric> AiMetrics => Set<AiMetric>();
    public DbSet<AiTerm> AiTerms => Set<AiTerm>();
    public DbSet<AiSummary> AiSummaries => Set<AiSummary>();
    public DbSet<DataSourceConnection> DataSourceConnections => Set<DataSourceConnection>();
    public DbSet<ReportVersion> ReportVersions => Set<ReportVersion>();
    public DbSet<RefreshSchedule> RefreshSchedules => Set<RefreshSchedule>();
    public DbSet<RefreshJob> RefreshJobs => Set<RefreshJob>();
    public DbSet<CustomVisual> CustomVisuals => Set<CustomVisual>();
    public DbSet<MarketplaceCatalog> MarketplaceCatalogs => Set<MarketplaceCatalog>();
    public DbSet<MarketplacePlugin> MarketplacePlugins => Set<MarketplacePlugin>();
    public DbSet<PowerBiConnection> PowerBiConnections => Set<PowerBiConnection>();
    public DbSet<SavedDaxModel> DaxModels => Set<SavedDaxModel>();
    public DbSet<Dataset> Datasets => Set<Dataset>();
    public DbSet<DatasetSource> DatasetSources => Set<DatasetSource>();
    public DbSet<DatasetRelationship> DatasetRelationships => Set<DatasetRelationship>();
    public DbSet<DatasetMeasure> DatasetMeasures => Set<DatasetMeasure>();
    public DbSet<ImportTable> ImportTables => Set<ImportTable>();
    public DbSet<BrandKit> BrandKits => Set<BrandKit>();
    public DbSet<DatasetCalculatedColumn> DatasetCalculatedColumns => Set<DatasetCalculatedColumn>();
    public DbSet<DatasetTransform> DatasetTransforms => Set<DatasetTransform>();
    public DbSet<Schedule> Schedules => Set<Schedule>();
    public DbSet<MailGroup> MailGroups => Set<MailGroup>();
    public DbSet<ScheduleRun> ScheduleRuns => Set<ScheduleRun>();
    public DbSet<DataDictionaryEntry> DataDictionary => Set<DataDictionaryEntry>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("core");

        // Apply all IEntityTypeConfiguration<T> from this assembly
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(TenantDbContext).Assembly);

        // UserPreference
        modelBuilder.Entity<UserPreference>(e =>
        {
            e.ToTable("UserPreference");
            e.HasKey(x => x.PreferenceId);
            e.Property(x => x.PreferenceId).UseIdentityColumn();
            e.Property(x => x.IsFavourite).HasDefaultValue(false);
            e.HasIndex(x => new { x.UserId, x.ControlTypeId, x.ControlId }).IsUnique();
        });

        // Dashboard
        modelBuilder.Entity<Dashboard>(e =>
        {
            e.ToTable("Dashboard");
            e.HasKey(x => x.DashboardId);
            e.Property(x => x.DashboardName).HasMaxLength(100).IsRequired();
            e.Property(x => x.Status).HasMaxLength(20).IsRequired();
            e.Property(x => x.Description).HasMaxLength(500);
            e.Property(x => x.DashboardSeriesId).HasDefaultValueSql("NEWID()");
            // Only the current-facing row per name (latest published version, or a
            // not-yet-versioned draft/completed row) must be unique; archived old
            // versions are excluded on purpose so they can share the same name.
            e.HasIndex(x => new { x.DashboardName, x.CategoryId })
                .IsUnique()
                .HasDatabaseName("UQ_Dashboard_Name_Category_Active")
                .HasFilter("[IsDeleted] = 0 AND ([IsLatestVersion] = 1 OR [VersionNo] IS NULL)");
            e.HasIndex(x => new { x.DashboardSeriesId, x.VersionNo })
                .IsUnique()
                .HasDatabaseName("UQ_Dashboard_Series_Version")
                .HasFilter("[VersionNo] IS NOT NULL AND [IsDeleted] = 0");
            e.HasIndex(x => x.DashboardSeriesId)
                .IsUnique()
                .HasDatabaseName("UQ_Dashboard_Series_ActiveDraft")
                .HasFilter("[VersionNo] IS NULL AND [IsDeleted] = 0");
        });

        // Comment (threaded, 1-level replies via ParentCommentId self-reference)
        modelBuilder.Entity<Comment>(e =>
        {
            e.ToTable("Comment");
            e.HasKey(x => x.CommentId);
            e.Property(x => x.CommentId).UseIdentityColumn();
            e.Property(x => x.TargetType).HasMaxLength(30).IsRequired();
            e.Property(x => x.AuthorDisplayName).HasMaxLength(200).IsRequired();
            e.Property(x => x.Body).HasMaxLength(2000).IsRequired();
            e.Property(x => x.MentionedUserIdsJson).HasMaxLength(500);
            e.HasIndex(x => new { x.TargetType, x.TargetId, x.IsDeleted });
            e.HasIndex(x => x.ParentCommentId);
        });

        // ChartLibrary
        modelBuilder.Entity<ChartLibrary>(e =>
        {
            e.ToTable("ChartLibrary");
            e.HasKey(x => x.ChartId);
            e.Property(x => x.ChartName).HasMaxLength(200).IsRequired();
            e.Property(x => x.WidgetType).HasMaxLength(30).IsRequired();
            e.Property(x => x.ChartType).HasMaxLength(30);
            e.HasOne(x => x.Category).WithMany().HasForeignKey(x => x.CategoryId);
        });

        base.OnModelCreating(modelBuilder);
    }
}
