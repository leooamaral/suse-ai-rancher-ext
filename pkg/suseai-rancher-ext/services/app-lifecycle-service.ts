/**
 * @fileoverview Application lifecycle service for SUSE AI extension
 * Handles installation, upgrading, and deletion of applications through Rancher's app management system.
 * This service provides a high-level interface for app lifecycle operations while handling
 * the complexity of Rancher's API calls and error handling.
 */

import { log as logger } from '../utils/logger';
import { createErrorHandler } from '../utils/error-handler';
import type {
  RancherStore,
  AppCRD,
  InstallationPayload
} from '../types/rancher-types';

/**
 * Extract HTTP status code from various error formats
 * @param e - Error object or value
 * @returns HTTP status code or null if not found
 */
function statusOf(e: unknown): number | null {
  if (!e || typeof e !== 'object') return null;
  const obj = e as {
    code?: number;
    data?: { code?: number };
    response?: { status?: number };
    status?: number
  };
  return obj.code || obj.data?.code || obj.response?.status || obj.status || null;
}

/**
 * Extract error message from various error formats
 * @param e - Error object or value
 * @returns Human-readable error message
 */
function getErrorMessage(e: unknown): string {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null) {
    const obj = e as {
      message?: string;
      data?: { message?: string };
      response?: { data?: { message?: string } }
    };
    return obj.message || obj.data?.message || obj.response?.data?.message || 'Unknown error';
  }
  return 'Unknown error';
}

/**
 * Extract error data from various error formats
 * @param e - Error object or value
 * @returns Error data payload or undefined
 */
function getErrorData(e: unknown): unknown {
  if (!e || typeof e !== 'object') return undefined;
  const obj = e as { data?: unknown; response?: { data?: unknown } };
  return obj.data || obj.response?.data;
}

/**
 * Reference to a Helm chart in a cluster repository
 * @interface ChartRef
 */
export interface ChartRef {
  /** Name of the ClusterRepo containing the chart */
  repoName: string;
  /** Name of the chart within the repository */
  chartName: string;
  /** SemVer version of the chart */
  version: string;
}

/**
 * Service for managing application lifecycle operations
 *
 * This service provides high-level methods for installing, upgrading, and deleting
 * applications in Rancher-managed clusters. It handles the complexity of Rancher's
 * API calls, error handling, and state management.
 *
 * @example
 * ```typescript
 * // Install an application
 * await AppLifecycleService.createOrUpgradeApp(
 *   store,
 *   'c-m-xyz',
 *   'default',
 *   'my-app',
 *   { repoName: 'suseai', chartName: 'llama-cpp', version: '1.0.0' },
 *   { cpu: '2', memory: '4Gi' }
 * );
 *
 * // Wait for installation to complete
 * const app = await AppLifecycleService.waitForAppInstall(
 *   store,
 *   'c-m-xyz',
 *   'default',
 *   'my-app'
 * );
 *
 * // Delete the application
 * await AppLifecycleService.deleteApp(store, 'c-m-xyz', 'default', 'my-app');
 * ```
 */
export class AppLifecycleService {

  /**
   * Create or upgrade an application in a Rancher-managed cluster
   *
   * This method handles both installation and upgrade scenarios:
   * - If the app doesn't exist, it will be installed
   * - If the app exists, it will be upgraded
   * - Uses Rancher's cluster repository API for operations
   *
   * @param $store - Rancher store instance for API calls
   * @param clusterId - Target cluster ID (e.g., 'c-m-xyz')
   * @param namespace - Kubernetes namespace for the application
   * @param releaseName - Unique name for the Helm release
   * @param chart - Chart reference including repository, chart name, and version
   * @param values - Helm values to customize the installation
   * @param preferredAction - Preferred action if the operation is ambiguous
   * @throws Error if installation/upgrade fails or cluster is unreachable
   *
   * @example
   * ```typescript
   * await AppLifecycleService.createOrUpgradeApp(
   *   store,
   *   'c-m-xyz',
   *   'suseai-apps',
   *   'llama-model-1',
   *   { repoName: 'suseai', chartName: 'llama-cpp', version: '1.2.0' },
   *   { cpu: '4', memory: '8Gi', modelSize: 'large' }
   * );
   * ```
   */
  static async createOrUpgradeApp(
    $store: RancherStore,
    clusterId: string,
    namespace: string,
    releaseName: string,
    chart: ChartRef,
    values: Record<string, unknown>,
    preferredAction: 'install' | 'upgrade' = 'install'
  ): Promise<void> {

    logger.info('Starting app lifecycle operation', {
      component: 'AppLifecycleService',
      data: {
        clusterId,
        namespace,
        releaseName,
        chart,
        preferredAction,
        valuesSize: JSON.stringify(values || {}).length
      }
    });

    const clusterReposUrl = `/k8s/clusters/${encodeURIComponent(clusterId)}/v1/catalog.cattle.io.clusterrepos/${chart.repoName}?action=${preferredAction}`;
    const appsUrl = `/k8s/clusters/${encodeURIComponent(clusterId)}/apis/catalog.cattle.io/v1/namespaces/${encodeURIComponent(namespace)}/apps`;
    const appUrl = `${appsUrl}/${encodeURIComponent(releaseName)}`;

    try {
      logger.debug('Fetching projects for cluster', {
        component: 'AppLifecycleService',
        data: { clusterId }
      });

      const projects = await $store.dispatch('rancher/findAll', {
        type: 'project',
        opt: { url: `/v3/clusters/${clusterId}/projects` }
      });

      const projectId = projects[0].clusterId;

      const charts = [
        {
          chartName: chart.chartName,
          version: chart.version,
          releaseName,
          annotations: {
            'catalog.cattle.io/ui-source-repo-type': 'cluster',
            'catalog.cattle.io/ui-source-repo': chart.repoName
          },
          values
        }
      ];

      const appPayload = {
        apiVersion: 'catalog.cattle.io/v1',
        kind: 'App',
        metadata: {
          namespace,
          name: releaseName,
          labels: { 'catalog.cattle.io/cluster-repo-name': chart.repoName },
          resourceVersion: undefined as string | undefined
        },
        spec: {
          chart: {
            metadata: {
              name: chart.chartName,
              version: chart.version,
            }
          },
          name: releaseName,
          namespace: namespace,
          values,
        },
      };

      // For upgrade actions, use the clusterRepo action directly
      if (preferredAction === 'upgrade') {
        logger.info('Performing upgrade via clusterRepo action', {
          component: 'AppLifecycleService',
          data: { releaseName }
        });

        const upgradeData = {
          charts,
          namespace,
          projectId,
          wait: true,
          timeout: '600s',
          noHooks: false,
          disableOpenAPIValidation: false,
          skipCRDs: false
        };

        try {
          const upgradeResult = await $store.dispatch('rancher/request', {
            method: 'post',
            url: clusterReposUrl,
            data: upgradeData
          });

          logger.info('App upgrade successful', {
            component: 'AppLifecycleService',
            data: { releaseName }
          });

          return;
        } catch (upgradeError: unknown) {
          const errorHandler = createErrorHandler($store, 'AppLifecycleService');
          const standardError = errorHandler.handleApiError(upgradeError, 'upgrade', { releaseName, namespace });
          throw new Error(`Failed to upgrade app: ${standardError.message}`);
        }
      }

      // For install actions, check if app exists first and use PUT if it does
      try {
        logger.debug('Checking for existing app', {
          component: 'AppLifecycleService',
          data: { namespace, releaseName }
        });

        const existing = await $store.dispatch('rancher/request', { url: appUrl });
        const resourceVersion = existing?.data?.metadata?.resourceVersion || existing?.metadata?.resourceVersion;

        if (resourceVersion) {
          logger.info('App exists, performing upgrade', {
            component: 'AppLifecycleService',
            data: { releaseName, resourceVersion }
          });

          appPayload.metadata.resourceVersion = resourceVersion;
          await $store.dispatch('rancher/request', {
            url: appUrl,
            method: 'PUT',
            data: appPayload,
          });

          logger.info('App upgrade successful', {
            component: 'AppLifecycleService',
            data: { releaseName }
          });
        } else {
          throw new Error('App exists but could not retrieve resourceVersion.');
        }
      } catch (e: unknown) {
        const status = statusOf(e);
        if (status === 404) {
          logger.info('App does not exist, performing install', {
            component: 'AppLifecycleService',
            data: { releaseName }
          });

          const installData = {
            charts,
            namespace,
            projectId,
            wait: true,
            timeout: '600s',
            noHooks: false,
            disableOpenAPIValidation: false,
            skipCRDs: false
          };

          try {
            await $store.dispatch('rancher/request', {
              method: 'post',
              url: clusterReposUrl,
              data: installData
            });

            logger.info('App install successful', {
              component: 'AppLifecycleService',
              data: { releaseName }
            });
          } catch (installError: unknown) {
            const errorHandler = createErrorHandler($store, 'AppLifecycleService');
            const standardError = errorHandler.handleApiError(installError, 'install', { releaseName, namespace });
            throw new Error(`Failed to install app: ${standardError.message}`);
          }
        } else {
          const errorHandler = createErrorHandler($store, 'AppLifecycleService');
          const standardError = errorHandler.handleApiError(e, 'install', { releaseName, namespace, status });
          throw new Error(`Failed to install/upgrade app: ${standardError.message}`);
        }
      }
    } catch (projectError: unknown) {
      const errorHandler = createErrorHandler($store, 'AppLifecycleService');
      const standardError = errorHandler.handleApiError(projectError, 'fetch', { operation: 'fetch projects' });
      throw new Error(`Failed to fetch projects: ${standardError.message}`);
    }

    logger.info('App lifecycle operation completed', {
      component: 'AppLifecycleService',
      data: { releaseName }
    });
  }

  /**
   * Wait for application installation or upgrade to complete
   *
   * Polls the application's status until the installation is complete or timeout is reached.
   * Monitors the observedGeneration vs generation to determine completion state.
   *
   * @param $store - Rancher store instance for API calls
   * @param clusterId - Target cluster ID
   * @param namespace - Kubernetes namespace containing the application
   * @param releaseName - Name of the Helm release to monitor
   * @param timeoutMs - Maximum time to wait in milliseconds (default: 90 seconds)
   * @returns Promise resolving to the complete App CRD
   * @throws Error if timeout is reached or installation fails
   *
   * @example
   * ```typescript
   * const app = await AppLifecycleService.waitForAppInstall(
   *   store,
   *   'c-m-xyz',
   *   'suseai-apps',
   *   'llama-model-1',
   *   120000 // 2 minutes timeout
   * );
   * console.log('App status:', app.status.summary.state);
   * ```
   */
  static async waitForAppInstall(
    $store: RancherStore,
    clusterId: string,
    namespace: string,
    releaseName: string,
    timeoutMs = 90_000
  ): Promise<AppCRD> {
    const url = `/k8s/clusters/${encodeURIComponent(clusterId)}/apis/catalog.cattle.io/v1/namespaces/${encodeURIComponent(namespace)}/apps/${encodeURIComponent(releaseName)}`;
    const start = Date.now();
    let lastErr: unknown = null;

    logger.info('Waiting for app install to complete', {
      component: 'AppLifecycleService',
      data: { clusterId, namespace, releaseName, timeoutMs }
    });

    for (;;) {
      try {
        const r = await $store.dispatch('rancher/request', { url });
        const app = (r?.data ?? r) || {};
        const gen = app?.metadata?.generation ?? 0;
        const obs = app?.status?.observedGeneration ?? 0;
        const sum = app?.status?.summary || {};
        const state = sum?.state || app?.status?.conditions?.find((c: { type: string; status: string }) => c?.type === 'Ready')?.status || 'Unknown';

        logger.debug('App status check', {
          component: 'AppLifecycleService',
          data: { releaseName, generation: gen, observedGeneration: obs, state }
        });

        if (obs >= gen) {
          logger.info('App install completed successfully', {
            component: 'AppLifecycleService',
            data: { releaseName }
          });
          return app;
        }
      } catch (e: unknown) {
        lastErr = e;
        const code = statusOf(e);
        if (code && code !== 404) {
          logger.warn('Non-404 error during app wait', {
            component: 'AppLifecycleService',
            data: { releaseName, statusCode: code }
          });
        }
      }

      if (Date.now() - start > timeoutMs) {
        const msg = getErrorMessage(lastErr) || (getErrorData(lastErr) as { message?: string })?.message || 'App did not appear in time';
        throw new Error(msg);
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  /**
   * Delete an application from a Rancher-managed cluster
   *
   * Uninstalls the application by calling Rancher's uninstall action.
   * This will remove the Helm release and associated Kubernetes resources.
   *
   * @param $store - Rancher store instance for API calls
   * @param clusterId - Target cluster ID
   * @param namespace - Kubernetes namespace containing the application
   * @param releaseName - Name of the Helm release to delete
   * @param repoName - Optional repository name for logging/context
   * @throws Error if deletion fails or application is not found
   *
   * @example
   * ```typescript
   * await AppLifecycleService.deleteApp(
   *   store,
   *   'c-m-xyz',
   *   'suseai-apps',
   *   'llama-model-1',
   *   'suseai'
   * );
   * ```
   */
  static async deleteApp(
    $store: RancherStore,
    clusterId: string,
    namespace: string,
    releaseName: string,
    repoName?: string
  ): Promise<void> {
    try {
      const url = `/k8s/clusters/${encodeURIComponent(clusterId)}/v1/catalog.cattle.io.apps/${encodeURIComponent(namespace)}/${encodeURIComponent(releaseName)}?action=uninstall`;

      logger.info('Deleting app', {
        component: 'AppLifecycleService',
        data: { clusterId, namespace, releaseName, repoName }
      });

      await $store.dispatch('rancher/request', {
        url,
        method: 'POST',
        data: { timeout: '600s' }
      });

      // Wait a bit for the deletion to process
      await new Promise(resolve => setTimeout(resolve, 5000));

      logger.info('App deleted successfully', {
        component: 'AppLifecycleService',
        data: { releaseName }
      });
    } catch (e: unknown) {
      const errorMsg = getErrorMessage(e);
      logger.error('Failed to delete app', e, {
        component: 'AppLifecycleService',
        data: { releaseName }
      });
      throw e;
    }
  }
}

// Legacy exports for backward compatibility
export const createOrUpgradeApp = AppLifecycleService.createOrUpgradeApp;
export const waitForAppInstall = AppLifecycleService.waitForAppInstall;
export const deleteApp = AppLifecycleService.deleteApp;