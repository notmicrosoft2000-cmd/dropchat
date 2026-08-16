# DropChat

A chat room and a file drop that lives on your Wi-Fi.

Run one Python file on one machine. Everyone else on the same network opens the address it prints, and they're in. No account, no internet, no install.

**Features**
- Real-time chat (names + history) over server-sent events
- Drag-and-drop file sharing into a shared upload folder
- Automatic discovery of other DropChat servers on your network (UDP broadcast)
- "Who's on my Wi-Fi" scan that labels every device on the ARP table
- Optional password gate via `?key=...`

**Run it**

```bash
python server.py
# pick a name and port
python server.py --name "The Living Room" --port 8000
# password-gated
python server.py --pass "s0me-key"
```

The server prints the address for the host machine and the Wi-Fi address for everyone else. Standard library only — needs Python 3 and nothing else.

**Flags**

| flag | default | meaning |
|------|---------|---------|
| `--port` | `8000` | HTTP port |
| `--name` | `DropChat` | server name shown in discovery |
| `--pass` | none | require `?key=...` on every request |
| `--max-mb` | `100` | upload size cap per file |

A Neptune Productions project.
