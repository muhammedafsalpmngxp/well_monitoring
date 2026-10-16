FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY . .
RUN dotnet restore gateway/SmartOps.Gateway.csproj
RUN dotnet publish gateway/SmartOps.Gateway.csproj -c Release -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_URLS=http://+:7000
EXPOSE 7000
ENTRYPOINT ["dotnet", "SmartOps.Gateway.dll"]
