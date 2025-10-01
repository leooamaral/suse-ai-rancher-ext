# SUSE AI Rancher Extension

A Rancher UI Extension for managing SUSE AI applications across Kubernetes clusters. This extension provides a unified interface for installing, managing, and monitoring AI workloads in Rancher-managed clusters.

## Architecture Overview

This extension follows established domain-model-driven architecture patterns that provide:

- **Domain Models**: Rich resource models with computed properties and actions
- **Centralized Store Management**: Vuex-style state management following standard patterns
- **Standard UI Components**: Consistent integration with Rancher's design system
- **Feature Flag System**: Version-aware feature management
- **Utility-First Architecture**: Reusable utility modules and services

## Key Architectural Patterns

### Domain Models (Resource-Centric Architecture)

The extension uses rich domain models that encapsulate both data and behavior.

### Internationalization (i18n)

Built-in support for multiple languages with structured translation keys in `l10n/en-us.json`.

### Component Organization

- **Formatters**: Specialized display components for status, progress, and resource visualization
- **Validators**: Reusable validation logic for forms and user input
- **Wizard Components**: Step-by-step installation and configuration flows

### Store Management

Centralized state management following Vuex patterns with modules for apps, clusters, installations, and repositories.

### Feature Flags

Version-aware feature management defined in `config/feature-flags.ts`.

### Standard UI Components

Components follow Rancher's design system patterns as much as possible:

- Custom ResourceTable implementations for data display with filtering and actions
- Consistent page headers and navigation
- Standardized form components with validation
- Status badges and progress indicators matching Rancher's visual style

## Development

### Prerequisites

- Node.js 20+ and Yarn
- Access to a Rancher cluster
- Extension developer features enabled in Rancher

### Setup

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd suseai-rancher-ext
   yarn install
   ```

2. **Build the extension:**
   ```bash
   yarn build-pkg suseai-rancher-ext
   ```

### Development Tools

The project includes comprehensive development tooling:

- **ESLint**: Code quality and style enforcement
- **Husky**: Git hooks for pre-commit validation
- **Commitlint**: Conventional commit message formatting
- **TypeScript**: Strong typing throughout the codebase

3. **Serve during development:**
   ```bash
   yarn serve-pkgs
   ```
   Copy the URL shown in the terminal.

4. **Load in Rancher:**
   - In Rancher, go to your user profile (top right) → Preferences
   - Enable "Extension Developer Features"
   - Navigate to Extensions from the side nav
   - Click the 3 dots (top right) → Developer Load
   - Paste the URL from step 3, select "Persist"
   - Reload the page

### Manual Testing

The extension provides functionality for:

- **Apps Management**: Browse and install AI applications
- **Multi-cluster Operations**: Install apps across multiple clusters
- **Lifecycle Management**: Upgrade, configure, and uninstall applications
- **Status Monitoring**: Real-time status tracking and error reporting

### Building for Production

```bash
yarn build-pkg suseai-rancher-ext --mode production
```

## Contributing

When contributing to this extension:

1. **Follow Standard Patterns**: Use the established domain model and store patterns
2. **Component Organization**: Place components in appropriate directories (formatters/, validators/, pages/)
3. **Type Safety**: Maintain strict TypeScript usage, avoid `any` types
4. **Internationalization**: Add translation keys to l10n/en-us.json for new UI text
5. **Code Quality**: Run `yarn lint` and ensure all pre-commit hooks pass
6. **Feature Flags**: Use feature flags for new functionality
7. **Manual Testing**: Ensure all functionality works across multi-cluster scenarios

### Commit Message Format

This project uses conventional commits enforced by commitlint:

```
type: subject

body (optional)

footer (optional)
```

**Valid types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`, `wip`, `deps`, `security`

Example:
```bash
git commit -m "feat: add multi-cluster installation support"
git commit -m "fix: resolve app installation error handling"
```

## Configuration

The extension supports various configuration options through the config system:

- **Internationalization**: Multi-language support with structured translation keys
- **Feature Flags**: Control feature availability per cluster version
- **Table Headers**: Customize ResourceTable displays
- **Validation Rules**: Configurable form validation for different input types
- **Settings**: Application-wide settings and preferences
- **Documentation Links**: Contextual help and documentation

## Troubleshooting

### Common Issues

1. **Extension not loading**: Verify URL in developer tools console
2. **Build errors**: Check Node.js version compatibility (requires 20+)
3. **API errors**: Verify cluster permissions and connectivity
4. **Linting errors**: Run `cd pkg/suseai-rancher-ext && yarn lint` to see details

### Debug Mode

Enable debug logging in development:

```bash
NODE_ENV=development yarn build-pkg suseai-rancher-ext
```
