#!/usr/bin/env python3
"""Disposable loopback SMTP transport sink. Never relays or delivers external mail."""
import argparse
import json
import os
from pathlib import Path
import socketserver
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("--directory", required=True)
args = parser.parse_args()
directory = Path(args.directory)
directory.mkdir(parents=True, exist_ok=True)


class SMTP(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(20)
        self.wfile.write(b"220 localhost First disposable SMTP sink\r\n")
        while line := self.rfile.readline(65536):
            command = line.split(b" ", 1)[0].strip().upper()
            if command in (b"EHLO", b"HELO"):
                self.wfile.write(b"250 localhost\r\n")
            elif command in (b"MAIL", b"RCPT", b"RSET", b"NOOP"):
                self.wfile.write(b"250 OK\r\n")
            elif command == b"DATA":
                self.wfile.write(b"354 End with a dot\r\n")
                with tempfile.NamedTemporaryFile(dir=directory, suffix=".eml", delete=False) as message:
                    while data := self.rfile.readline(65536):
                        if data == b".\r\n":
                            break
                        message.write(data[1:] if data.startswith(b"..") else data)
                    message.flush()
                    os.fsync(message.fileno())
                self.wfile.write(b"250 Stored locally\r\n")
            elif command == b"QUIT":
                self.wfile.write(b"221 Bye\r\n")
                return
            else:
                self.wfile.write(b"502 Not supported\r\n")


with socketserver.ThreadingTCPServer(("127.0.0.1", 0), SMTP) as server:
    server.daemon_threads = True
    print(json.dumps({"host": "127.0.0.1", "port": server.server_address[1]}), flush=True)
    server.serve_forever()
