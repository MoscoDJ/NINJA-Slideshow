import 'dart:io';
import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:crypto/crypto.dart';
import 'dart:convert';
import '../models/slide_file.dart';

class CacheService {
  final Dio _dio = Dio();
  late Directory _cacheDir;
  bool _initialized = false;
  final Map<String, String> _cachedPaths = {};

  Future<void> init() async {
    if (_initialized) return;
    final appDir = await getApplicationSupportDirectory();
    _cacheDir = Directory('${appDir.path}/slideshow_cache');
    if (!await _cacheDir.exists()) {
      await _cacheDir.create(recursive: true);
    }
    // Index existing cached files
    try {
      for (final entry in _cacheDir.listSync()) {
        if (entry is File) {
          _cachedPaths[entry.uri.pathSegments.last] = entry.path;
        }
      }
    } catch (_) {}
    _initialized = true;
  }

  String _cacheKey(SlideFile file) {
    // Strip query params from URL for stable cache keys
    final baseUrl = file.url.split('?').first;
    final hash = md5.convert(utf8.encode(baseUrl)).toString();
    final ext = file.type.isNotEmpty ? file.type : '.bin';
    return '$hash$ext';
  }

  /// Returns local path if file is already cached.
  String? getCachedPath(SlideFile file) {
    final key = _cacheKey(file);
    final path = _cachedPaths[key];
    if (path != null && File(path).existsSync()) return path;
    return null;
  }

  /// Downloads a single file in background. Returns local path on success.
  Future<String?> downloadInBackground(SlideFile file) async {
    await init();
    final key = _cacheKey(file);
    if (_cachedPaths.containsKey(key)) {
      final existing = File(_cachedPaths[key]!);
      if (existing.existsSync()) return existing.path;
    }

    final localPath = '${_cacheDir.path}/$key';
    try {
      await _dio.download(file.url, localPath);
      _cachedPaths[key] = localPath;
      return localPath;
    } catch (_) {
      return null;
    }
  }

  /// Starts background sync: downloads missing files, removes stale ones.
  /// Non-blocking — returns immediately, downloads happen in background.
  Future<void> syncInBackground(List<SlideFile> files) async {
    await init();
    final neededKeys = <String>{};

    for (final file in files) {
      final key = _cacheKey(file);
      neededKeys.add(key);
      if (!_cachedPaths.containsKey(key)) {
        // Download in background, don't await all at once
        downloadInBackground(file);
      }
    }

    // Remove stale files
    try {
      for (final entry in _cacheDir.listSync()) {
        if (entry is File) {
          final name = entry.uri.pathSegments.last;
          if (!neededKeys.contains(name)) {
            entry.deleteSync();
            _cachedPaths.remove(name);
          }
        }
      }
    } catch (_) {}
  }
}
