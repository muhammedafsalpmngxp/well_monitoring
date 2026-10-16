# syntax=docker/dockerfile:1
# Build context is the `smartops/` directory:
#   docker build -f services/dotnet/TWise.Backend.ControlPlane/src/TWise.ControlPlane.API/Dockerfile .
#
# Note the directory/assembly name mismatch: the folder is TWise.ControlPlane.API
# but the project (and therefore the DLL) is TWise.Backend.ControlPlane.API.

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Restore layer — csproj graph only, so it caches independently of source edits.
# Directory.Build.props supplies TargetFramework and must be present for restore.
COPY Directory.Build.props ./
COPY services/dotnet/TWise.Backend.ControlPlane/src/TWise.ControlPlane.API/TWise.Backend.ControlPlane.API.csproj                       services/dotnet/TWise.Backend.ControlPlane/src/TWise.ControlPlane.API/
COPY services/dotnet/TWise.Backend.ControlPlane/src/TWise.ControlPlane.Application/TWise.Backend.ControlPlane.Application.csproj       services/dotnet/TWise.Backend.ControlPlane/src/TWise.ControlPlane.Application/
COPY services/dotnet/TWise.Backend.ControlPlane/src/TWise.ControlPlane.Infrastructure/TWise.Backend.ControlPlane.Infrastructure.csproj services/dotnet/TWise.Backend.ControlPlane/src/TWise.ControlPlane.Infrastructure/
COPY services/dotnet/TWise.Backend.ControlPlane/src/TWise.ControlPlane.Domain/TWise.Backend.ControlPlane.Domain.csproj                 services/dotnet/TWise.Backend.ControlPlane/src/TWise.ControlPlane.Domain/
COPY shared/dotnet/SmartOps.Shared/SmartOps.Shared.csproj                                                                             shared/dotnet/SmartOps.Shared/
RUN dotnet restore services/dotnet/TWise.Backend.ControlPlane/src/TWise.ControlPlane.API/TWise.Backend.ControlPlane.API.csproj

COPY services/dotnet/TWise.Backend.ControlPlane/ services/dotnet/TWise.Backend.ControlPlane/
COPY shared/dotnet/                              shared/dotnet/
RUN dotnet publish services/dotnet/TWise.Backend.ControlPlane/src/TWise.ControlPlane.API/TWise.Backend.ControlPlane.API.csproj \
      -c Release -o /app/publish --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
# WORKDIR /app is load-bearing: Provisioning:SchemaScriptPath is the relative
# path "sql/init-tenant-schema.sql", resolved against the working directory.
WORKDIR /app
COPY --from=build /app/publish ./
RUN mkdir -p /app/logs && chown -R $APP_UID:$APP_UID /app/logs
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_EnableDiagnostics=0
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "TWise.Backend.ControlPlane.API.dll"]
