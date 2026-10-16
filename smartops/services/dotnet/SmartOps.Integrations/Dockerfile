FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish services/dotnet/SmartOps.Integrations/SmartOps.Integrations.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_URLS=http://+:7006
EXPOSE 7006
ENTRYPOINT ["dotnet", "SmartOps.Integrations.dll"]
