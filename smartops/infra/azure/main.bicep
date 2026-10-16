// Azure Bicep — provisions the SmartOps shared infrastructure:
//   • Azure Container Registry
//   • Azure Kubernetes Service (AKS)
//   • Azure SQL (managed MSSQL) + Database
//   • Azure Cache for Redis
//   • Azure Service Bus namespace
//   • Azure API Management (Consumption tier)
//   • Azure Key Vault
//
// Deploy: az deployment group create -g <rg> -f main.bicep -p main.parameters.json

param location string = resourceGroup().location
param namePrefix string = 'smartops'
param sqlAdminLogin string = 'smartops'
@secure()
param sqlAdminPassword string

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: '${namePrefix}acr'
  location: location
  sku: { name: 'Standard' }
  properties: { adminUserEnabled: true }
}

resource aks 'Microsoft.ContainerService/managedClusters@2024-05-01' = {
  name: '${namePrefix}-aks'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    dnsPrefix: namePrefix
    agentPoolProfiles: [{
      name: 'default'
      count: 2
      vmSize: 'Standard_D2s_v5'
      mode: 'System'
      osType: 'Linux'
    }]
    enableRBAC: true
  }
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: '${namePrefix}-sql'
  location: location
  properties: {
    administratorLogin: sqlAdminLogin
    administratorLoginPassword: sqlAdminPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource sqlDb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: 'smartops'
  location: location
  sku: { name: 'S1', tier: 'Standard' }
}

resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: '${namePrefix}-redis'
  location: location
  properties: {
    sku: { name: 'Standard', family: 'C', capacity: 1 }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}

resource sb 'Microsoft.ServiceBus/namespaces@2024-01-01' = {
  name: '${namePrefix}-sb'
  location: location
  sku: { name: 'Standard', tier: 'Standard' }
}

resource apim 'Microsoft.ApiManagement/service@2023-09-01-preview' = {
  name: '${namePrefix}-apim'
  location: location
  sku: { name: 'Consumption', capacity: 0 }
  identity: { type: 'SystemAssigned' }
  properties: {
    publisherEmail: 'admin@smartops.example.com'
    publisherName:  'SmartOps Platform'
  }
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${namePrefix}-kv'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

output acrLoginServer string = acr.properties.loginServer
output aksName string = aks.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output redisHost string = redis.properties.hostName
output apimGatewayUrl string = apim.properties.gatewayUrl
output kvUri string = kv.properties.vaultUri
