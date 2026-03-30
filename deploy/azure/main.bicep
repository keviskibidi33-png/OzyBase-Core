param location string = resourceGroup().location
param baseName string = 'ozybase'
param containerImage string
param containerCpu int = 1
param containerMemory string = '2Gi'
param minReplicas int = 1
param maxReplicas int = 3
param siteUrl string
param appDomain string
param allowedOrigins string = ''
param postgresSkuName string = 'GP_Standard_D2ds_v4'
param postgresVersion string = '16'
param postgresStorageSizeGB int = 128
param postgresAdminLogin string
@secure()
param postgresAdminPassword string
param postgresDbName string = 'ozybase'
@secure()
param jwtSecret string
@secure()
param anonKey string
@secure()
param serviceRoleKey string
param smtpHost string = ''
param smtpPort string = '587'
param smtpUser string = ''
@secure()
param smtpPassword string = ''
param smtpFrom string = 'noreply@example.com'
var keyVaultSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

var logAnalyticsName = '${baseName}-law'
var managedEnvironmentName = '${baseName}-env'
var identityName = '${baseName}-uai'
var keyVaultName = toLower(replace('${baseName}-${uniqueString(resourceGroup().id)}', '-', ''))
var postgresServerName = toLower('${baseName}-${uniqueString(resourceGroup().id, 'pg')}')
var postgresHost = '${postgresServerName}.postgres.database.azure.com'
var databaseUrl = 'postgres://${postgresAdminLogin}:${postgresAdminPassword}@${postgresHost}:5432/${postgresDbName}?sslmode=require'
var poolerUrl = 'postgres://${postgresAdminLogin}:${postgresAdminPassword}@${postgresHost}:6432/${postgresDbName}?sslmode=require'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    accessPolicies: []
    enableRbacAuthorization: true
    enabledForDeployment: false
    enabledForTemplateDeployment: true
    enabledForDiskEncryption: false
    publicNetworkAccess: 'Enabled'
  }
}

resource keyVaultSecretsUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, identity.id, 'key-vault-secrets-user')
  scope: keyVault
  properties: {
    roleDefinitionId: keyVaultSecretsUserRoleId
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource kvJwtSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  name: '${keyVault.name}/jwt-secret'
  properties: {
    value: jwtSecret
  }
}

resource kvAnonKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  name: '${keyVault.name}/anon-key'
  properties: {
    value: anonKey
  }
}

resource kvServiceRoleKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  name: '${keyVault.name}/service-role-key'
  properties: {
    value: serviceRoleKey
  }
}

resource kvDatabaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  name: '${keyVault.name}/database-url'
  properties: {
    value: databaseUrl
  }
}

resource kvPoolerUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  name: '${keyVault.name}/db-pooler-url'
  properties: {
    value: poolerUrl
  }
}

resource kvSMTPPassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(smtpPassword)) {
  name: '${keyVault.name}/smtp-password'
  properties: {
    value: smtpPassword
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: postgresServerName
  location: location
  sku: {
    name: postgresSkuName
    tier: 'GeneralPurpose'
  }
  properties: {
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    version: postgresVersion
    storage: {
      storageSizeGB: postgresStorageSizeGB
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    highAvailability: {
      mode: 'ZoneRedundant'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
  }
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  name: '${postgres.name}/${postgresDbName}'
}

resource postgresPgBouncer 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-06-01-preview' = {
  name: '${postgres.name}/pgbouncer.enabled'
  properties: {
    value: 'true'
    source: 'user-override'
  }
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: managedEnvironmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: listKeys(logAnalytics.id, '2023-09-01').primarySharedKey
      }
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: baseName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8090
        transport: 'auto'
      }
      secrets: [
        {
          name: 'jwt-secret'
          keyVaultUrl: kvJwtSecret.properties.secretUri
          identity: identity.id
        }
        {
          name: 'anon-key'
          keyVaultUrl: kvAnonKey.properties.secretUri
          identity: identity.id
        }
        {
          name: 'service-role-key'
          keyVaultUrl: kvServiceRoleKey.properties.secretUri
          identity: identity.id
        }
        {
          name: 'database-url'
          keyVaultUrl: kvDatabaseUrl.properties.secretUri
          identity: identity.id
        }
        {
          name: 'db-pooler-url'
          keyVaultUrl: kvPoolerUrl.properties.secretUri
          identity: identity.id
        }
        if (!empty(smtpPassword)) {
          name: 'smtp-password'
          keyVaultUrl: kvSMTPPassword.properties.secretUri
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'ozybase'
          image: containerImage
          env: [
            {
              name: 'PORT'
              value: '8090'
            }
            {
              name: 'OZY_DEPLOYMENT_PROFILE'
              value: 'azure_cloud'
            }
            {
              name: 'DEBUG'
              value: 'false'
            }
            {
              name: 'OZY_STRICT_SECURITY'
              value: 'true'
            }
            {
              name: 'SITE_URL'
              value: siteUrl
            }
            {
              name: 'APP_DOMAIN'
              value: appDomain
            }
            {
              name: 'ALLOWED_ORIGINS'
              value: allowedOrigins
            }
            {
              name: 'JWT_SECRET'
              secretRef: 'jwt-secret'
            }
            {
              name: 'ANON_KEY'
              secretRef: 'anon-key'
            }
            {
              name: 'SERVICE_ROLE_KEY'
              secretRef: 'service-role-key'
            }
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
            {
              name: 'DB_POOLER_URL'
              secretRef: 'db-pooler-url'
            }
            {
              name: 'SMTP_HOST'
              value: smtpHost
            }
            {
              name: 'SMTP_PORT'
              value: smtpPort
            }
            {
              name: 'SMTP_USER'
              value: smtpUser
            }
            if (!empty(smtpPassword)) {
              name: 'SMTP_PASSWORD'
              secretRef: 'smtp-password'
            }
            {
              name: 'SMTP_FROM'
              value: smtpFrom
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health'
                port: 8090
              }
              initialDelaySeconds: 15
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/health'
                port: 8090
              }
              initialDelaySeconds: 10
              periodSeconds: 15
            }
          ]
          resources: {
            cpu: containerCpu
            memory: containerMemory
          }
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
  dependsOn: [
    postgresDatabase
    postgresPgBouncer
    keyVaultSecretsUserAssignment
  ]
}

output containerAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output postgresHost string = postgresHost
output postgresDatabase string = postgresDbName
output keyVaultName string = keyVault.name
