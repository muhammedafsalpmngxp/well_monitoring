# syntax=docker/dockerfile:1
# Build context is the `smartops/` directory:
#   docker build -f services/dotnet/TWise.Backend.Tenant/src/TWise.Tenant.API/Dockerfile .

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY Directory.Build.props ./
COPY services/dotnet/TWise.Backend.Tenant/src/TWise.Tenant.API/TWise.Tenant.API.csproj                       services/dotnet/TWise.Backend.Tenant/src/TWise.Tenant.API/
COPY services/dotnet/TWise.Backend.Tenant/src/TWise.Tenant.Application/TWise.Tenant.Application.csproj       services/dotnet/TWise.Backend.Tenant/src/TWise.Tenant.Application/
COPY services/dotnet/TWise.Backend.Tenant/src/TWise.Tenant.Infrastructure/TWise.Tenant.Infrastructure.csproj services/dotnet/TWise.Backend.Tenant/src/TWise.Tenant.Infrastructure/
COPY services/dotnet/TWise.Backend.Tenant/src/TWise.Tenant.Domain/TWise.Tenant.Domain.csproj                 services/dotnet/TWise.Backend.Tenant/src/TWise.Tenant.Domain/
RUN dotnet restore services/dotnet/TWise.Backend.Tenant/src/TWise.Tenant.API/TWise.Tenant.API.csproj

COPY services/dotnet/TWise.Backend.Tenant/ services/dotnet/TWise.Backend.Tenant/
RUN dotnet publish services/dotnet/TWise.Backend.Tenant/src/TWise.Tenant.API/TWise.Tenant.API.csproj \
      -c Release -o /app/publish --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
COPY --from=build /app/publish ./
RUN mkdir -p /app/logs && chown -R $APP_UID:$APP_UID /app/logs
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_EnableDiagnostics=0
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "TWise.Tenant.API.dll"]
