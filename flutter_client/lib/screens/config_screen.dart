import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import '../services/settings_service.dart';

class ConfigScreen extends StatefulWidget {
  final void Function(String url) onConfigured;

  const ConfigScreen({super.key, required this.onConfigured});

  @override
  State<ConfigScreen> createState() => _ConfigScreenState();
}

class _ConfigScreenState extends State<ConfigScreen> {
  final _urlController = TextEditingController();
  final _durationController = TextEditingController(text: '15');
  final _urlFocus = FocusNode();
  final _durationFocus = FocusNode();
  final _buttonFocus = FocusNode();
  String? _error;
  bool _testing = false;

  @override
  void initState() {
    super.initState();
    _loadSaved();
  }

  Future<void> _loadSaved() async {
    final url = await SettingsService.getServerUrl();
    final duration = await SettingsService.getImageDuration();
    if (url != null) _urlController.text = url;
    _durationController.text = duration.toString();
  }

  Future<void> _testAndSave() async {
    final url = _urlController.text.trim().replaceAll(RegExp(r'/+$'), '');
    if (url.isEmpty) {
      setState(() => _error = 'Ingresa la URL del servidor');
      return;
    }

    setState(() {
      _testing = true;
      _error = null;
    });

    try {
      final response = await http
          .get(Uri.parse('$url/api/files'))
          .timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) {
        throw Exception('Server responded with ${response.statusCode}');
      }

      final duration =
          int.tryParse(_durationController.text.trim()) ?? 15;
      await SettingsService.setServerUrl(url);
      await SettingsService.setImageDuration(duration);

      widget.onConfigured(url);
    } catch (e) {
      setState(() => _error = 'No se pudo conectar: $e');
    } finally {
      setState(() => _testing = false);
    }
  }

  @override
  void dispose() {
    _urlController.dispose();
    _durationController.dispose();
    _urlFocus.dispose();
    _durationFocus.dispose();
    _buttonFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: FocusTraversalGroup(
          policy: OrderedTraversalPolicy(),
          child: Container(
            constraints: const BoxConstraints(maxWidth: 480),
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.slideshow, size: 64, color: Colors.red),
                const SizedBox(height: 16),
                const Text(
                  'NINJA Slideshow',
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 32),
                FocusTraversalOrder(
                  order: const NumericFocusOrder(1),
                  child: TextField(
                    controller: _urlController,
                    focusNode: _urlFocus,
                    autofocus: true,
                    style: const TextStyle(fontSize: 18),
                    decoration: const InputDecoration(
                      labelText: 'Server URL',
                      hintText: 'https://slideshow.ninja.com.mx',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.link),
                      contentPadding:
                          EdgeInsets.symmetric(horizontal: 16, vertical: 18),
                    ),
                    keyboardType: TextInputType.url,
                    textInputAction: TextInputAction.next,
                    onSubmitted: (_) =>
                        FocusScope.of(context).requestFocus(_durationFocus),
                  ),
                ),
                const SizedBox(height: 16),
                FocusTraversalOrder(
                  order: const NumericFocusOrder(2),
                  child: TextField(
                    controller: _durationController,
                    focusNode: _durationFocus,
                    style: const TextStyle(fontSize: 18),
                    decoration: const InputDecoration(
                      labelText: 'Duración de imágenes (segundos)',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.timer),
                      contentPadding:
                          EdgeInsets.symmetric(horizontal: 16, vertical: 18),
                    ),
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) =>
                        FocusScope.of(context).requestFocus(_buttonFocus),
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Colors.red)),
                ],
                const SizedBox(height: 24),
                FocusTraversalOrder(
                  order: const NumericFocusOrder(3),
                  child: SizedBox(
                    width: double.infinity,
                    height: 56,
                    child: ElevatedButton(
                      focusNode: _buttonFocus,
                      onPressed: _testing ? null : _testAndSave,
                      style: ElevatedButton.styleFrom(
                        textStyle: const TextStyle(fontSize: 18),
                      ),
                      child: _testing
                          ? const SizedBox(
                              width: 24,
                              height: 24,
                              child:
                                  CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Conectar'),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
