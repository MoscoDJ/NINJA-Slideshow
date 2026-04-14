import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
import '../models/slide_file.dart';
import '../services/api_service.dart';
import '../services/cache_service.dart';
import '../services/settings_service.dart';
import '../services/socket_service.dart';

class SlideshowScreen extends StatefulWidget {
  final String serverUrl;
  final VoidCallback onOpenSettings;

  const SlideshowScreen({
    super.key,
    required this.serverUrl,
    required this.onOpenSettings,
  });

  @override
  State<SlideshowScreen> createState() => _SlideshowScreenState();
}

class _SlideshowScreenState extends State<SlideshowScreen> {
  late final ApiService _api;
  late final SocketService _socket;
  final CacheService _cache = CacheService();

  List<SlideFile> _files = [];
  int _currentIndex = 0;
  bool _initialLoading = true;
  double _fadeOpacity = 1.0;
  double _progress = 0.0;
  int _imageDuration = 15;

  Player? _player;
  VideoController? _videoController;
  Timer? _imageTimer;
  Timer? _videoTimeoutTimer;
  Timer? _progressTimer;
  StreamSubscription? _socketSub;
  StreamSubscription? _playerCompleteSub;
  StreamSubscription? _playerPlayingSub;
  bool _disposed = false;
  bool _videoStarted = false;
  DateTime? _slideStartTime;

  @override
  void initState() {
    super.initState();
    _api = ApiService(widget.serverUrl);
    _socket = SocketService(widget.serverUrl);
    _socket.connect();
    _socketSub = _socket.onFilesUpdated.listen((_) => _refresh());
    _init();
  }

  Future<void> _init() async {
    _imageDuration = await SettingsService.getImageDuration();
    await _cache.init();
    await _refresh();
  }

  Future<void> _refresh() async {
    try {
      final files = await _api.fetchFiles();
      if (_disposed) return;

      final indexReset =
          _files.isEmpty || files.length != _files.length || _currentIndex >= files.length;

      setState(() {
        _files = files;
        _initialLoading = false;
        if (indexReset) _currentIndex = 0;
      });

      _startCurrentSlide();
      _cache.syncInBackground(files);
    } catch (e) {
      if (_disposed) return;
      if (_files.isNotEmpty) return;
      setState(() => _initialLoading = false);
    }
  }

  void _startCurrentSlide() {
    _cancelAllTimers();
    if (_files.isEmpty) return;
    final file = _files[_currentIndex];
    _slideStartTime = DateTime.now();
    _progress = 0.0;

    if (file.isVideo) {
      _videoStarted = false;
      _playVideo(file);
      // Safety timeout: skip video if it doesn't start within 15s
      _videoTimeoutTimer = Timer(const Duration(seconds: 15), () {
        if (!_videoStarted) {
          debugPrint('Video timeout, skipping: ${file.name}');
          _goToNext();
        }
      });
    } else {
      _imageTimer = Timer(Duration(seconds: _imageDuration), _goToNext);
      _startProgressTicker();
    }
  }

  void _startProgressTicker() {
    _progressTimer?.cancel();
    _progressTimer = Timer.periodic(const Duration(milliseconds: 100), (_) {
      if (_slideStartTime == null || _disposed) return;
      final elapsed = DateTime.now().difference(_slideStartTime!).inMilliseconds;
      final total = _imageDuration * 1000;
      setState(() => _progress = (elapsed / total).clamp(0.0, 1.0));
    });
  }

  void _playVideo(SlideFile file) {
    _disposePlayer();

    _player = Player();
    _videoController = VideoController(_player!);

    _playerCompleteSub = _player!.stream.completed.listen((completed) {
      if (completed && _videoStarted) _goToNext();
    });

    // Track when video actually starts playing
    _playerPlayingSub = _player!.stream.playing.listen((playing) {
      if (playing && !_videoStarted) {
        _videoStarted = true;
        _videoTimeoutTimer?.cancel();
        _slideStartTime = DateTime.now();
      }
    });

    // Track video progress
    _player!.stream.position.listen((position) {
      if (_disposed) return;
      final duration = _player?.state.duration ?? Duration.zero;
      if (duration.inMilliseconds > 0) {
        setState(() => _progress = (position.inMilliseconds / duration.inMilliseconds).clamp(0.0, 1.0));
      }
    });

    final localPath = _cache.getCachedPath(file);
    final source = (localPath != null && File(localPath).existsSync())
        ? 'file://$localPath'
        : file.url;

    debugPrint('Playing: ${file.name} from ${localPath != null ? "cache" : "network"}');
    _player!.open(Media(source));

    setState(() {});
  }

  void _goToNext() {
    if (_files.isEmpty || _disposed) return;

    _cancelAllTimers();
    setState(() => _fadeOpacity = 0.0);

    Future.delayed(const Duration(milliseconds: 800), () {
      if (_disposed) return;
      _disposePlayer();
      setState(() {
        _currentIndex = (_currentIndex + 1) % _files.length;
        _fadeOpacity = 1.0;
        _progress = 0.0;
      });
      _startCurrentSlide();
    });
  }

  void _cancelAllTimers() {
    _imageTimer?.cancel();
    _imageTimer = null;
    _videoTimeoutTimer?.cancel();
    _videoTimeoutTimer = null;
    _progressTimer?.cancel();
    _progressTimer = null;
  }

  void _disposePlayer() {
    _playerCompleteSub?.cancel();
    _playerCompleteSub = null;
    _playerPlayingSub?.cancel();
    _playerPlayingSub = null;
    _player?.dispose();
    _player = null;
    _videoController = null;
  }

  @override
  void dispose() {
    _disposed = true;
    _cancelAllTimers();
    _disposePlayer();
    _socketSub?.cancel();
    _socket.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: CallbackShortcuts(
        bindings: <ShortcutActivator, VoidCallback>{
          const SingleActivator(LogicalKeyboardKey.escape): widget.onOpenSettings,
          const SingleActivator(LogicalKeyboardKey.keyS): widget.onOpenSettings,
          const SingleActivator(LogicalKeyboardKey.goBack): widget.onOpenSettings,
          const SingleActivator(LogicalKeyboardKey.select): widget.onOpenSettings,
          const SingleActivator(LogicalKeyboardKey.contextMenu): widget.onOpenSettings,
        },
        child: Focus(
          autofocus: true,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (_initialLoading)
                _buildLoading()
              else if (_files.isEmpty)
                _buildEmpty()
              else
                AnimatedOpacity(
                  opacity: _fadeOpacity,
                  duration: const Duration(milliseconds: 800),
                  child: _buildSlide(),
                ),
              // Progress bar
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: LinearProgressIndicator(
                  value: _progress,
                  minHeight: 3,
                  backgroundColor: Colors.black26,
                  valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFFEC1C24)),
                ),
              ),
              // Connection indicator
              Positioned(
                top: 8,
                right: 8,
                child: _buildStatusDot(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLoading() {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(color: Colors.red),
          SizedBox(height: 16),
          Text('Cargando contenido...', style: TextStyle(color: Colors.white54)),
        ],
      ),
    );
  }

  Widget _buildEmpty() {
    return const Center(
      child: Text('No hay contenido disponible', style: TextStyle(color: Colors.white54, fontSize: 20)),
    );
  }

  Widget _buildSlide() {
    final file = _files[_currentIndex];

    if (file.isVideo && _videoController != null) {
      return Video(controller: _videoController!, fill: Colors.black);
    }

    final localPath = _cache.getCachedPath(file);
    if (localPath != null && File(localPath).existsSync()) {
      return Image.file(
        File(localPath),
        fit: BoxFit.contain,
        width: double.infinity,
        height: double.infinity,
        errorBuilder: (_, e, s) => _buildNetworkImage(file),
      );
    }

    return _buildNetworkImage(file);
  }

  Widget _buildNetworkImage(SlideFile file) {
    return Image.network(
      file.url,
      fit: BoxFit.contain,
      width: double.infinity,
      height: double.infinity,
      loadingBuilder: (_, child, progress) {
        if (progress == null) return child;
        return const Center(child: CircularProgressIndicator(color: Colors.red));
      },
      errorBuilder: (_, e, s) => const Center(
        child: Icon(Icons.broken_image, color: Colors.white24, size: 64),
      ),
    );
  }

  Widget _buildStatusDot() {
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: _socket.isConnected ? Colors.green : Colors.red,
      ),
    );
  }
}
