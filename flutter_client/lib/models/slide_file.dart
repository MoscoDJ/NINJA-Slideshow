class SlideFile {
  final String name;
  final String url;
  final String type;
  final String? lastModified;

  SlideFile({
    required this.name,
    required this.url,
    required this.type,
    this.lastModified,
  });

  factory SlideFile.fromJson(Map<String, dynamic> json) {
    return SlideFile(
      name: json['name'] as String,
      url: json['url'] as String,
      type: json['type'] as String,
      lastModified: json['lastModified'] as String?,
    );
  }

  bool get isVideo => type == '.mp4' || type == '.webm';
}
