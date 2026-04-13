import 'package:flutter_test/flutter_test.dart';
import 'package:ninja_slideshow/main.dart';

void main() {
  testWidgets('App starts', (WidgetTester tester) async {
    await tester.pumpWidget(const NinjaSlideshowApp());
    expect(find.byType(NinjaSlideshowApp), findsOneWidget);
  });
}
