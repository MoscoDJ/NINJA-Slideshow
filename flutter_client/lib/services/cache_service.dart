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

  Future<void> init() async {
    if (_initialized) return;
    final appDir = await getApplicationSupportDirectory();
    _cacheDir = Directory('${appDir.path}/slideshow_cache');
    if (!await _cacheDir.exists()) {
      await _cacheDir.create(recursive: true);
    }
    _initialized = true;
  }

  String _hashUrl(String url) {
    return md5.convert(utf8.encode(url)).toString();
  }

  String _getExtension(SlideFile file) {
    return file.type.isNotEmpty ? file.type : '.bin';
  }

  File _localFile(SlideFile file) {
    final hash = _hashUrl(file.url);
    final ext = _getExtension(file);
    return File('${_cacheDir.path}/$hash$ext');
  }

  /// Returns the local path if cached, null otherwise.
  String? getCachedPath(SlideFile file) {
    final f = _localFile(file);
    return f.existsSync() ? f.path : null;
  }

  /// Downloads a file and returns the local path.
  Future<String> download(
    SlideFile file, {
    void Function(int received, int total)? onProgress,
  }) async {
    await init();
    final local = _localFile(file);
    if (local.existsSync()) return local.path;

    await _dio.download(
      file.url,
      local.path,
      onReceiveProgress: onProgress,
    );
    return local.path;
  }

  /// Syncs the cache: downloads new files, deletes stale ones.
  /// Returns a map of filename -> local path for all current files.
  Future<Map<String, String>> sync(
    List<SlideFile> files, {
    void Function(int done, int total)? onProgress,
  }) async {
    await init();

    final result = <String, String>{};
    final neededHashes = <String>{};
    int done = 0;

    for (final file in files) {
      final hash = _hashUrl(file.url);
      final ext = _getExtension(file);
      neededHashes.add('$hash$ext');

      final local = _localFile(file);
      if (local.existsSync()) {
        result[file.name] = local.path;
      } else {
        try {
          final path = await download(file);
          result[file.name] = path;
        } catch (e) {
          // Skip files that fail to download
        }
      }
      done++;
      onProgress?.call(done, files.length);
    }

    // Remove stale cached files
    try {
      final entries = _cacheDir.listSync();
      for (final entry in entries) {
        if (entry is File) {
          final name = entry.uri.pathSegments.last;
          if (!neededHashes.contains(name)) {
            entry.deleteSync();
          }
        }
      }
    } catch (_) {}

    return result;
  }
}
