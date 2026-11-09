import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time

main, home = sys.argv[1], sys.argv[2]
master, slave = pty.openpty()
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 20, 40, 0, 0))
env = dict(os.environ, RANN_HOME=home, TERM="xterm-256color")
child = subprocess.Popen(["node", main], stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True)
os.close(slave)
os.set_blocking(master, False)
buffer = b""

def pump(deadline):
    global buffer
    while time.time() < deadline:
        ready, _, _ = select.select([master], [], [], 0.05)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                return False
            if not chunk:
                return False
            buffer += chunk

def wait_for(needle, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        pump(min(deadline, time.time() + 0.1))
        if needle.encode() in buffer:
            return True
    return False

first = wait_for("\u203a", 10)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 200, 0, 0))
os.kill(child.pid, signal.SIGWINCH)
resized = wait_for("\u203a", 5)
os.write(master, b"/exit")
pump(time.time() + 0.4)
os.write(master, b"\r")
end = time.time() + 2
while time.time() < end and child.poll() is None:
    pump(time.time() + 0.1)
if child.poll() is None:
    os.write(master, b"\x1b")
    pump(time.time() + 0.2)
    os.write(master, b"\r")
    end = time.time() + 2
    while time.time() < end and child.poll() is None:
        pump(time.time() + 0.1)
if child.poll() is None:
    os.write(master, b"\x04")
    end = time.time() + 2
    while time.time() < end and child.poll() is None:
        pump(time.time() + 0.1)
if child.poll() is None:
    os.write(master, b"\x03")
    end = time.time() + 2
    while time.time() < end and child.poll() is None:
        pump(time.time() + 0.1)
if child.poll() is None:
    child.kill()
    try:
        child.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
text = buffer.decode("utf-8", "replace")
print(json.dumps({"first": first, "resized": resized, "exit": child.returncode, "output": text[-4000:]}))
