import argparse
from pathlib import Path

from .auth import DEFAULT_AUTH_PATH, login as do_login
from .capture import capture
from .normalize import normalize


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="suno-tape",
        description=(
            "Record the audio a public Suno share page plays, via an OS "
            "audio loopback (BlackHole) -- like dubbing a broadcast to "
            "tape. Never touches Suno's encrypted stream."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_login = sub.add_parser("login", help="One-time interactive login, saved for later captures")
    p_login.add_argument("--auth-path", type=Path, default=DEFAULT_AUTH_PATH)

    p_capture = sub.add_parser("capture", help="Record a Suno share page's playback to a wav file")
    p_capture.add_argument("share_url", help="A Suno share URL, e.g. https://suno.com/s/XXXXXXXX")
    p_capture.add_argument("out_wav", type=Path, help="Output .wav path")
    p_capture.add_argument("--output-device", default="BlackHole + Steinberg",
                            help="System output device to switch to while recording "
                                 "(must feed --input-device). Default: %(default)s")
    p_capture.add_argument("--input-device", default="BlackHole 2ch",
                            help="ffmpeg avfoundation input device to record from. "
                                 "Default: %(default)s")
    p_capture.add_argument("--auth-path", type=Path, default=DEFAULT_AUTH_PATH)
    p_capture.add_argument("--normalize", action="store_true",
                            help="Apply loudness normalization (ffmpeg loudnorm, -16 LUFS) after capture")

    args = parser.parse_args()

    if args.command == "login":
        do_login(args.auth_path)
        return

    out = capture(
        args.share_url, args.out_wav,
        output_device=args.output_device,
        input_device=args.input_device,
        auth_path=args.auth_path,
    )
    if args.normalize:
        normalize(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
