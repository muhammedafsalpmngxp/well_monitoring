FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish services/dotnet/SmartOps.Wells/src/SmartOps.Wells.API/SmartOps.Wells.API.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_URLS=http://+:7002
EXPOSE 7002
ENTRYPOINT ["dotnet", "SmartOps.Wells.API.dll"]
