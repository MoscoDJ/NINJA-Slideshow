import 'package:shared_preferences/shared_preferences.dart';

class SettingsService {
  static const _keyServerUrl = 'server_url';
  static const _keyImageDuration = 'image_duration';

  static Future<String?> getServerUrl() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyServerUrl);
  }

  static Future<void> setServerUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyServerUrl, url);
  }

  static Future<int> getImageDuration() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getInt(_keyImageDuration) ?? 15;
  }

  static Future<void> setImageDuration(int seconds) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_keyImageDuration, seconds);
  }
}
