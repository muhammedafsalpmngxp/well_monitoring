FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish services/dotnet/SmartOps.Finance/SmartOps.Finance.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_URLS=http://+:7003
EXPOSE 7003
ENTRYPOINT ["dotnet", "SmartOps.Finance.dll"]
