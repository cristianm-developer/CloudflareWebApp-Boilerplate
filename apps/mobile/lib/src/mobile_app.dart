import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'app_environment.dart';
import 'play_billing_bridge.dart';

class MobileApp extends StatefulWidget {
  const MobileApp({required this.environment, super.key});

  final AppEnvironment environment;

  @override
  State<MobileApp> createState() => _MobileAppState();
}

class _MobileAppState extends State<MobileApp> {
  late final WebViewController _controller;
  late final PlayBillingBridge _billing;
  late final Uri _appUri;
  late String _bridgeNonce;
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _appUri = AppEnvironmentConfig.appUri(widget.environment);
    _bridgeNonce = _newNonce();
    _billing = PlayBillingBridge(
      allowedProductIds: AppEnvironmentConfig.playProductIds,
      emitToWeb: _emitToWeb,
    )..start();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel(
        'NativeBridge',
        onMessageReceived: (message) => _handleBridgeMessage(message.message),
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) => _isAllowedUri(Uri.tryParse(request.url))
              ? NavigationDecision.navigate
              : NavigationDecision.prevent,
          onPageStarted: (_) {
            _bridgeNonce = _newNonce();
            if (mounted) setState(() => _isLoading = true);
          },
          onPageFinished: (url) async {
            if (!_isAllowedUri(Uri.tryParse(url))) return;
            await _controller.runJavaScript(
              'window.__NATIVE_BRIDGE_NONCE = ${jsonEncode(_bridgeNonce)};',
            );
            if (mounted) setState(() => _isLoading = false);
          },
          onWebResourceError: (error) {
            if (error.isForMainFrame == true && mounted) {
              setState(() {
                _error = 'Could not load the ${AppEnvironmentConfig.label(widget.environment)} app.';
                _isLoading = false;
              });
            }
          },
        ),
      )
      ..loadRequest(_appUri);
  }

  @override
  void dispose() {
    _billing.dispose();
    super.dispose();
  }

  bool _isAllowedUri(Uri? uri) {
    if (uri == null || uri.userInfo.isNotEmpty) return false;
    return uri.scheme == _appUri.scheme &&
        uri.host == _appUri.host &&
        uri.port == _appUri.port;
  }

  Future<void> _handleBridgeMessage(String rawMessage) async {
    if (rawMessage.length > 16 * 1024) return;
    final Object? decoded;
    try {
      decoded = jsonDecode(rawMessage);
    } on FormatException {
      return;
    }
    if (decoded is! Map<String, dynamic> ||
        decoded['version'] != 1 ||
        decoded['nonce'] != _bridgeNonce ||
        decoded['id'] is! String ||
        (decoded['id'] as String).isEmpty ||
        decoded['type'] is! String ||
        !_isAllowedUri(Uri.tryParse(await _controller.currentUrl() ?? ''))) {
      return;
    }

    final requestId = decoded['id'] as String;
    try {
      final result = await _billing.dispatch(
        type: decoded['type'] as String,
        request: decoded,
      );
      _emitToWeb({'version': 1, 'id': requestId, 'type': 'bridge.result', 'result': result});
    } on FormatException catch (error) {
      _emitToWeb({
        'version': 1,
        'id': requestId,
        'type': 'bridge.error',
        'error': error.message,
      });
    } catch (_) {
      _emitToWeb({
        'version': 1,
        'id': requestId,
        'type': 'bridge.error',
        'error': 'native_operation_failed',
      });
    }
  }

  void _emitToWeb(Map<String, Object?> event) {
    if (!mounted) return;
    final encodedStringLiteral = jsonEncode(jsonEncode(event));
    _controller.runJavaScript('''
      if (window.location.origin === ${jsonEncode(_appUri.origin)}) {
        window.dispatchEvent(new CustomEvent('nativeBridgeEvent', {
          detail: JSON.parse($encodedStringLiteral)
        }));
      }
    ''');
  }

  String _newNonce() {
    final random = Random.secure();
    return List<int>.generate(32, (_) => random.nextInt(256))
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
  }

  Future<void> _reload() async {
    setState(() {
      _error = null;
      _isLoading = true;
    });
    await _controller.loadRequest(_appUri);
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Cloudflare Apps',
        theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff2854c5))),
        home: Scaffold(
          body: SafeArea(
            child: Stack(
              children: [
                WebViewWidget(controller: _controller),
                if (_isLoading) const LinearProgressIndicator(minHeight: 2),
                if (_error case final error?)
                  ColoredBox(
                    color: Theme.of(context).colorScheme.surface,
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(error),
                          const SizedBox(height: 12),
                          FilledButton(onPressed: _reload, child: const Text('Retry')),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      );
}
