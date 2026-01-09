import argparse
import http.server
import os
import ssl
from typing import Tuple


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the UI over HTTPS.")
    parser.add_argument(
        "--directory",
        default="ui",
        help="Directory to serve (default: ui)",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host interface to bind (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=3000,
        help="Port to bind (default: 3000)",
    )
    parser.add_argument(
        "--certfile",
        default=os.environ.get("UI_SSL_CERTFILE", ""),
        help="Path to TLS certificate file (or UI_SSL_CERTFILE env).",
    )
    parser.add_argument(
        "--keyfile",
        default=os.environ.get("UI_SSL_KEYFILE", ""),
        help="Path to TLS key file (or UI_SSL_KEYFILE env).",
    )
    return parser.parse_args()


def build_server(directory: str, host: str, port: int) -> Tuple[http.server.ThreadingHTTPServer, str, str]:
    handler = http.server.SimpleHTTPRequestHandler
    os.chdir(directory)
    server = http.server.ThreadingHTTPServer((host, port), handler)
    return server, directory, os.getcwd()


def main() -> None:
    args = parse_args()
    if not args.certfile or not args.keyfile:
        raise SystemExit("Missing --certfile/--keyfile (or UI_SSL_CERTFILE/UI_SSL_KEYFILE env vars).")

    server, directory, cwd = build_server(args.directory, args.host, args.port)
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_context.load_cert_chain(certfile=args.certfile, keyfile=args.keyfile)
    server.socket = ssl_context.wrap_socket(server.socket, server_side=True)

    print(f"Serving {directory} from {cwd} at https://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
