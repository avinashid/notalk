#!/usr/bin/env python3
"""
notalk - Ultra-lightweight development server with proper WASM MIME type.
Run: python3 serve.py [port]
"""
import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable cross-origin isolation headers for high-performance WebAssembly
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

Handler.extensions_map.update({
    '.wasm': 'application/wasm',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.json': 'application/json',
})

print(f"✨ notalk is running live at http://localhost:{PORT}")
print("   Open multiple browser tabs or windows to chat in real time!")
with socketserver.TCPServer(("", PORT), Handler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")

