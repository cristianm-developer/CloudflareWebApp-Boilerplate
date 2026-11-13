import 'package:flutter/material.dart';

import 'src/app_environment.dart';
import 'src/mobile_app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(MobileApp(environment: AppEnvironmentConfig.fromBuildConfig()));
}
