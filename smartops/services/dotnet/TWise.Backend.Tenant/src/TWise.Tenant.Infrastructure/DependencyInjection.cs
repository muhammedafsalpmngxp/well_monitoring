using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Infrastructure.Delivery;
using TWise.Tenant.Infrastructure.Persistence;
using TWise.Tenant.Infrastructure.Reporting;
using TWise.Tenant.Infrastructure.Repositories;
using TWise.Tenant.Infrastructure.Services;
using TWise.Tenant.Infrastructure.Services.Legacy;

namespace TWise.Tenant.Infrastructure;

public static class DependencyInjection
{
    /// <summary>
    /// Registers Infrastructure layer services: EF Core DbContext, repositories, and domain services.
    /// Call from Program.cs: <c>builder.Services.AddInfrastructure(builder.Configuration);</c>
    /// </summary>
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // EF Core — registered via a factory (singleton-safe) so GlobalSearchRepository can spin up
        // extra DbContext instances for concurrent queries; the scoped TenantDbContext used
        // everywhere else is created from the same factory per-request, so there is still exactly
        // one DbContextOptions source (registering AddDbContext + AddDbContextFactory separately
        // for the same TContext throws "Cannot consume scoped service ... from singleton" at
        // startup, since AddDbContextFactory's options must be singleton-resolvable).
        services.AddDbContextFactory<TenantDbContext>(opt =>
        {
            var cs = configuration.GetConnectionString("TenantDb")
                ?? throw new InvalidOperationException("ConnectionStrings:TenantDb is not configured.");
            opt.UseSqlServer(cs, sql => sql.CommandTimeout(120));
        });
        services.AddScoped(sp => sp.GetRequiredService<IDbContextFactory<TenantDbContext>>().CreateDbContext());

        // Repositories
        services.AddScoped(typeof(IRepository<>), typeof(GenericRepository<>));
        services.AddScoped<IDashboardRepository, DashboardRepository>();
        services.AddScoped<IGlobalSearchRepository, GlobalSearchRepository>();
        services.AddScoped<ICategoryRepository, CategoryRepository>();
        services.AddScoped<IReportRepository, ReportRepository>();
        services.AddScoped<IReportTemplateRepository, ReportTemplateRepository>();
        services.AddScoped<ILearnVideoRepository, LearnVideoRepository>();
        services.AddScoped<ISourceRepository, SourceRepository>();
        services.AddScoped<IWidgetRepository, WidgetRepository>();
        services.AddScoped<IUserPreferenceRepository, UserPreferenceRepository>();
        services.AddScoped<IDashboardSavedFilterRepository, DashboardSavedFilterRepository>();
        services.AddScoped<IDatabaseConnectionRepository, DatabaseConnectionRepository>();
        services.AddScoped<IDatabaseViewRepository, DatabaseViewRepository>();
        services.AddScoped<ICrewAssignmentRepository, CrewAssignmentRepository>();
        services.AddScoped<IReliabilityRepository, ReliabilityRepository>();
        services.AddScoped<ICommentRepository, CommentRepository>();
        services.AddScoped<IImportedDatasetRepository, ImportedDatasetRepository>();
        services.AddScoped<IAiSettingsRepository, AiSettingsRepository>();
        services.AddScoped<IAiUsageRepository, AiUsageRepository>();
        services.AddScoped<IAiProviderRepository, AiProviderRepository>();
        services.AddScoped<IAiFeatureRoleRepository, AiFeatureRoleRepository>();
        services.AddScoped<IAiConversationRepository, AiConversationRepository>();
        services.AddScoped<IAiAlertRepository, AiAlertRepository>();
        services.AddScoped<IAiAgentRepository, AiAgentRepository>();
        services.AddScoped<IAiKnowledgeRepository, AiKnowledgeRepository>();
        services.AddScoped<IDataSourceConnectionRepository, DataSourceConnectionRepository>();
        services.AddScoped<IRefreshRepository, RefreshRepository>();
        services.AddScoped<ICustomVisualRepository, CustomVisualRepository>();
        services.AddScoped<IMarketplaceCatalogRepository, MarketplaceCatalogRepository>();
        services.AddScoped<IMarketplacePluginRepository, MarketplacePluginRepository>();
        services.AddScoped<IMarketplaceService, MarketplaceService>();
        services.AddHttpClient(nameof(MarketplaceService), c => c.Timeout = TimeSpan.FromSeconds(20));

        // Power BI embedding: service-principal token exchange and embed-token minting.
        services.AddScoped<IPowerBiConnectionRepository, PowerBiConnectionRepository>();
        services.AddScoped<IDaxModelRepository, DaxModelRepository>();
        services.AddScoped<IDaxFunctionRepository, DaxFunctionRepository>();
        services.AddScoped<IPowerBiService, PowerBiService>();
        services.AddHttpClient(nameof(PowerBiService), c => c.Timeout = TimeSpan.FromSeconds(30));
        services.AddScoped<IDatasetRepository, DatasetRepository>();
        services.AddScoped<IImportTableStore, ImportTableStore>();
        services.AddScoped<IBrandKitStore, BrandKitStore>();

        // Services
        services.AddScoped<ICurrentUserService, CurrentUserService>();
        services.AddScoped<IReportService, ReportService>();
        services.AddScoped<ISourceService, SourceService>();
        services.AddScoped<IWidgetService, WidgetService>();
        services.AddScoped<IUserPreferenceService, UserPreferenceService>();
        services.AddScoped<IDashboardSavedFilterService, DashboardSavedFilterService>();
        services.AddScoped<ICommentService, CommentService>();
        services.AddScoped<IDashboardPermissionService, DashboardPermissionService>();
        services.AddScoped<IImportedDatasetService, ImportedDatasetService>();
        services.AddScoped<IFileImportParserService, FileImportParserService>();
        services.AddScoped<IDashboardLogoStorage, DashboardLogoStorage>();

        // External SQL data sources — one dialect provider per supported engine.
        services.AddSingleton<Application.Abstractions.DataSources.ISqlDialectProvider, DataSources.Sql.MsSqlDialectProvider>();
        services.AddSingleton<Application.Abstractions.DataSources.ISqlDialectProvider, DataSources.Sql.PostgresDialectProvider>();
        services.AddSingleton<Application.Abstractions.DataSources.ISqlDialectProvider, DataSources.Sql.MySqlDialectProvider>();
        services.AddSingleton<Application.Abstractions.DataSources.ISqlDialectProvider, DataSources.Sql.MariaDbDialectProvider>();
        services.AddSingleton<Application.Abstractions.DataSources.ISqlDialectProvider, DataSources.Sql.RedshiftDialectProvider>();
        services.AddSingleton<Application.Abstractions.DataSources.ISqlDialectProvider, DataSources.Sql.ClickHouseDialectProvider>();
        services.AddSingleton<Application.Abstractions.DataSources.ISqlDialectProvider, DataSources.Sql.TrinoDialectProvider>();
        services.AddSingleton<Application.Abstractions.DataSources.ISqlProviderFactory, DataSources.Sql.SqlProviderFactory>();
        services.AddScoped<IGovernanceService, GovernanceService>();

        // Pull-based data sources (Google Sheets/Drive, REST API). Connectors fetch a tabular
        // snapshot which is materialised into ImportedDatasets, so charts consume them unchanged.
        services.AddHttpClient(DataSources.Connectors.RestApiConnector.HttpClientName, client =>
            {
                client.Timeout = TimeSpan.FromSeconds(60);
            })
            // Redirects are followed manually so every hop is re-checked by OutboundUrlGuard.
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });

        services.AddHttpClient(DataSources.Connectors.GoogleOAuthService.HttpClientName, client =>
        {
            client.Timeout = TimeSpan.FromSeconds(30);
        });

        services.AddScoped<Application.Abstractions.DataSources.IGoogleOAuthService, DataSources.Connectors.GoogleOAuthService>();
        services.AddScoped<Application.Abstractions.DataSources.IDataSourceConnector, DataSources.Connectors.RestApiConnector>();
        services.AddScoped<Application.Abstractions.DataSources.IDataSourceConnector, DataSources.Connectors.GoogleSheetsConnector>();
        services.AddScoped<Application.Abstractions.DataSources.IDataSourceConnector, DataSources.Connectors.GoogleDriveConnector>();
        services.AddScoped<Application.Abstractions.DataSources.IDataSourceConnectorFactory, DataSources.Connectors.DataSourceConnectorFactory>();
        services.AddScoped<IDataSourceConnectionService, DataSourceConnectionService>();

        // Refresh scheduling. The evaluator is stateless so it is a singleton; the executor is
        // scoped because it depends on the DbContext, and the worker opens a scope per tick.
        services.AddSingleton<Application.Abstractions.Services.ICronEvaluator, CronEvaluator>();
        services.AddScoped<Application.Abstractions.Services.IRefreshExecutor, RefreshExecutor>();
        services.AddScoped<Application.Abstractions.Services.IRefreshService, RefreshService>();
        services.AddHostedService<RefreshWorker>();

        services.AddScoped<IDatabaseConnectionService, DatabaseConnectionService>();
        services.AddScoped<IDatabaseViewService, DatabaseViewService>();
        services.AddScoped<IModelQueryService, ModelQueryService>();
        services.AddScoped<IDashboardShareAccessService, DashboardShareAccessService>();

        // LEGACY: remove when data migrates to tenant DB
        services.AddScoped<ILegacyCrewCalendarService, LegacyCrewCalendarService>();

        // Reporting
        // Notifications — write-on-event into ControlPlane's centralized store (control.Notification/
        // NotificationRecipient) via its internal ingest endpoint, instead of deriving them at
        // read-time from Tenant DB. See ShareDashboardInternallyHandler / ExecuteValidationRuleHandler
        // for the two call sites.
        void UseControlPlane(HttpClient client)
        {
            var baseUrl = configuration["ControlPlane:BaseUrl"]
                ?? throw new InvalidOperationException("ControlPlane:BaseUrl is not configured.");
            client.BaseAddress = new Uri(baseUrl);
            var apiKey = configuration["ControlPlane:ApiKey"]
                ?? throw new InvalidOperationException("ControlPlane:ApiKey is not configured.");
            client.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
        }
        services.AddHttpClient<TWise.Tenant.Application.Abstractions.Services.IControlPlaneNotificationClient,
            TWise.Tenant.Infrastructure.Services.ControlPlaneNotificationClient>((_, client) => UseControlPlane(client));

        // Scheduled deliveries: owners and recipients are read from the control plane at each run; the worker is
        // added in Program.cs. Mail settings are under Mail, worker settings under Delivery.
        services.AddHttpClient<IRecipientResolver, ControlPlaneDirectoryClient>((_, client) => UseControlPlane(client));
        services.AddScoped<IScheduleStore, ScheduleStore>();
        services.AddScoped<IMailGroupStore, MailGroupStore>();
        services.AddSingleton<IMailSender, SmtpMailSender>();
        services.AddScoped<IDeliveryRenderer, ReportDeliveryRenderer>();
        services.AddScoped<IDeliveryRenderer, CanvasDeliveryRenderer>();
        services.AddScoped<IDeliveryRenderer, DashboardDeliveryRenderer>();

        // AI: one OpenAI-compatible transport; settings/quota/logging wrapper is IAiService.
        services.AddHttpClient<IAiChatClient, OpenAiCompatibleChatClient>(c => c.Timeout = TimeSpan.FromSeconds(60));
        services.AddSingleton<IAiKeyProtector, AiKeyProtector>();
        services.AddScoped<IAiService, AiService>();
        services.AddScoped<IAiPromptStore, AiPromptStore>();
        services.AddScoped<IAskDataCatalogReader, AskDataCatalogReader>();
        services.AddScoped<IAiAskService, AiAskService>();
        services.AddScoped<IAiAlertService, AiAlertService>();
        services.AddHostedService<AiAlertWorker>();
        services.AddScoped<IAiViewQueryRunner, AiViewQueryRunner>();

        // Agentic AI: agents built on Create New Agent run in the Python agent runtime (LangGraph).
        services.AddHttpClient<IAgentRuntimeClient, AgentRuntimeClient>(client =>
        {
            client.BaseAddress = new Uri((configuration["AgentRuntime:BaseUrl"] ?? "http://localhost:8006").TrimEnd('/') + "/");
            client.Timeout = TimeSpan.FromMinutes(10);   // a run streams until every step is done
            if (configuration["AgentRuntime:ApiKey"] is { Length: > 0 } key) client.DefaultRequestHeaders.Add("X-API-Key", key);
        });

        services.AddScoped<ReportDataFetcher>();

        return services;
    }
}
