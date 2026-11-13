import 'package:flutter/services.dart' show appFlavor;

enum AppEnvironment { local, stage, production }

class AppEnvironmentConfig {
  AppEnvironmentConfig._();

  static const _name = String.fromEnvironment('APP_ENV', defaultValue: 'local');
  static const _localOrigin = String.fromEnvironment(
    'LOCAL_APP_ORIGIN',
    defaultValue: 'http://10.0.2.2:4321',
  );
  static const _stageOrigin = String.fromEnvironment(
    'STAGE_APP_ORIGIN',
    defaultValue: 'https://stage.example.com',
  );
  static const _productionOrigin = String.fromEnvironment(
    'PRODUCTION_APP_ORIGIN',
    defaultValue: 'https://app.example.com',
  );
  static const _playProductIds = String.fromEnvironment(
    'PLAY_PRODUCT_IDS',
    defaultValue: '',
  );

  static AppEnvironment fromBuildConfig() {
    final environment = switch (_name) {
      'local' => AppEnvironment.local,
      'stage' => AppEnvironment.stage,
      'production' => AppEnvironment.production,
      _ => throw StateError('APP_ENV must be local, stage, or production.'),
    };
    if (appFlavor != null && appFlavor != _name) {
      throw StateError('APP_ENV must match the Android flavor ($appFlavor).');
    }
    return environment;
  }

  static String appOrigin(AppEnvironment environment) => switch (environment) {
        AppEnvironment.local => _localOrigin,
        AppEnvironment.stage => _stageOrigin,
        AppEnvironment.production => _productionOrigin,
      };

  static Uri appUri(AppEnvironment environment) {
    final uri = Uri.tryParse(appOrigin(environment));
    if (uri == null || !uri.isAbsolute || uri.host.isEmpty || uri.userInfo.isNotEmpty) {
      throw StateError('The configured app origin is not a valid absolute URL.');
    }
    final isLocalHttp = environment == AppEnvironment.local && uri.scheme == 'http';
    if (!isLocalHttp && uri.scheme != 'https') {
      throw StateError('Only the local environment may use HTTP.');
    }
    if (uri.query.isNotEmpty || uri.fragment.isNotEmpty) {
      throw StateError('Configure an origin without a query or fragment.');
    }
    return uri;
  }

  static Set<String> get playProductIds => _playProductIds
      .split(',')
      .map((id) => id.trim())
      .where((id) => id.isNotEmpty)
      .toSet();

  static String label(AppEnvironment environment) => switch (environment) {
        AppEnvironment.local => 'Local',
        AppEnvironment.stage => 'Stage',
        AppEnvironment.production => 'Production',
      };
}
