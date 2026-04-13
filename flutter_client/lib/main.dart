import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:media_kit/media_kit.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'screens/config_screen.dart';
import 'screens/slideshow_screen.dart';
import 'services/settings_service.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  MediaKit.ensureInitialized();

  // Fullscreen immersive mode (hides status bar / nav bar on Android TV)
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);

  // Keep screen awake (critical for kiosk/slideshow use)
  WakelockPlus.enable();

  runApp(const NinjaSlideshowApp());
}

class NinjaSlideshowApp extends StatefulWidget {
  const NinjaSlideshowApp({super.key});

  @override
  State<NinjaSlideshowApp> createState() => _NinjaSlideshowAppState();
}

class _NinjaSlideshowAppState extends State<NinjaSlideshowApp> {
  String? _serverUrl;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final url = await SettingsService.getServerUrl();
    setState(() {
      _serverUrl = url;
      _loading = false;
    });
  }

  void _onConfigured(String url) {
    setState(() => _serverUrl = url);
  }

  void _onOpenSettings() {
    setState(() => _serverUrl = null);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NINJA Slideshow',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(useMaterial3: true).copyWith(
        scaffoldBackgroundColor: Colors.black,
      ),
      home: _loading
          ? const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            )
          : _serverUrl != null && _serverUrl!.isNotEmpty
              ? SlideshowScreen(
                  serverUrl: _serverUrl!,
                  onOpenSettings: _onOpenSettings,
                )
              : ConfigScreen(onConfigured: _onConfigured),
    );
  }
}
