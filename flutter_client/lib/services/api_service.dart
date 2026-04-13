import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/slide_file.dart';

class ApiService {
  final String serverUrl;

  ApiService(this.serverUrl);

  Future<List<SlideFile>> fetchFiles() async {
    final uri = Uri.parse('$serverUrl/api/files');
    final response = await http.get(uri).timeout(const Duration(seconds: 15));

    if (response.statusCode != 200) {
      throw Exception('Failed to fetch files: ${response.statusCode}');
    }

    final List<dynamic> data = json.decode(response.body);
    return data.map((item) => SlideFile.fromJson(item)).toList();
  }
}
