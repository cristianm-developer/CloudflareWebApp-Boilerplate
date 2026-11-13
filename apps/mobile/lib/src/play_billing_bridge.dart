import 'dart:async';

import 'package:in_app_purchase/in_app_purchase.dart';

typedef BridgeEmitter = void Function(Map<String, Object?> event);

/// Starts Play purchase UI and returns purchase tokens to the trusted web app.
/// This class does not call Google Play Developer API or grant entitlements.
class PlayBillingBridge {
  PlayBillingBridge({required this.allowedProductIds, required this.emitToWeb});

  final Set<String> allowedProductIds;
  final BridgeEmitter emitToWeb;
  final InAppPurchase _store = InAppPurchase.instance;
  final Map<String, PurchaseDetails> _uncompletedPurchases = {};
  StreamSubscription<List<PurchaseDetails>>? _purchaseSubscription;

  void start() {
    _purchaseSubscription ??= _store.purchaseStream.listen(
      _onPurchaseUpdates,
      onError: (_) => emitToWeb({
        'version': 1,
        'type': 'billing.error',
        'error': 'purchase_stream_failed',
      }),
    );
  }

  Future<Object?> dispatch({required String type, required Map<String, dynamic> request}) async {
    return switch (type) {
      'billing.purchase' => _purchase(request['productId']),
      'billing.restore' => _restore(),
      'billing.complete' => _complete(request['purchaseId']),
      _ => throw const FormatException('unsupported_native_operation'),
    };
  }

  Future<Map<String, Object?>> _purchase(Object? rawProductId) async {
    if (rawProductId is! String || !allowedProductIds.contains(rawProductId)) {
      throw const FormatException('product_not_allowed');
    }
    if (!await _store.isAvailable()) {
      throw const FormatException('store_unavailable');
    }

    final response = await _store.queryProductDetails({rawProductId});
    if (response.error != null || response.productDetails.isEmpty) {
      throw const FormatException('product_unavailable');
    }
    final product = response.productDetails.firstWhere((item) => item.id == rawProductId);
    final started = await _store.buyNonConsumable(
      purchaseParam: PurchaseParam(productDetails: product),
    );
    if (!started) throw const FormatException('purchase_not_started');
    return {'accepted': true, 'productId': rawProductId};
  }

  Future<Map<String, Object?>> _restore() async {
    if (!await _store.isAvailable()) throw const FormatException('store_unavailable');
    await _store.restorePurchases();
    return {'accepted': true};
  }

  Future<Map<String, Object?>> _complete(Object? rawPurchaseId) async {
    if (rawPurchaseId is! String) throw const FormatException('purchase_id_required');
    final purchase = _uncompletedPurchases.remove(rawPurchaseId);
    if (purchase == null) throw const FormatException('purchase_not_pending_completion');
    if (purchase.pendingCompletePurchase) await _store.completePurchase(purchase);
    return {'completed': true, 'purchaseId': rawPurchaseId};
  }

  void _onPurchaseUpdates(List<PurchaseDetails> updates) {
    for (final purchase in updates) {
      final purchaseId = _purchaseId(purchase);
      if (purchase.status == PurchaseStatus.pending) {
        emitToWeb({
          'version': 1,
          'type': 'billing.purchaseUpdate',
          'purchaseId': purchaseId,
          'productId': purchase.productID,
          'status': 'pending',
        });
        continue;
      }

      if (purchase.status == PurchaseStatus.purchased ||
          purchase.status == PurchaseStatus.restored) {
        if (purchase.pendingCompletePurchase) _uncompletedPurchases[purchaseId] = purchase;
        emitToWeb({
          'version': 1,
          'type': 'billing.purchaseUpdate',
          'purchaseId': purchaseId,
          'productId': purchase.productID,
          'status': purchase.status.name,
          // The web app submits this token to the authenticated backend for verification.
          'purchaseToken': purchase.verificationData.serverVerificationData,
        });
        continue;
      }

      emitToWeb({
        'version': 1,
        'type': 'billing.purchaseUpdate',
        'purchaseId': purchaseId,
        'productId': purchase.productID,
        'status': purchase.status.name,
        if (purchase.error != null) 'error': purchase.error!.code,
      });
    }
  }

  String _purchaseId(PurchaseDetails purchase) =>
      '${purchase.productID}:${purchase.purchaseID ?? purchase.transactionDate ?? 'unknown'}';

  Future<void> dispose() async {
    await _purchaseSubscription?.cancel();
  }
}
