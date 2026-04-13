import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;

class SocketService {
  io.Socket? _socket;
  final String serverUrl;
  final _controller = StreamController<void>.broadcast();
  bool _disposed = false;

  SocketService(this.serverUrl);

  Stream<void> get onFilesUpdated => _controller.stream;

  bool get isConnected => _socket?.connected ?? false;

  void connect() {
    _socket = io.io(
      serverUrl,
      io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .disableAutoConnect()
          .build(),
    );

    _socket!.onConnect((_) {
      // ignore: avoid_print
      print('Socket.IO connected');
    });

    _socket!.onDisconnect((_) {
      // ignore: avoid_print
      print('Socket.IO disconnected');
    });

    _socket!.on('filesUpdated', (_) {
      if (!_disposed) {
        _controller.add(null);
      }
    });

    _socket!.connect();
  }

  void dispose() {
    _disposed = true;
    _socket?.disconnect();
    _socket?.dispose();
    _controller.close();
  }
}
