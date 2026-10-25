"""Versioned BLE provisioning codec, independent of Linux/BlueZ.

The high-entropy, short-lived QR secret authenticates an AES-GCM channel.
Distinct directional keys, a fresh connection salt and monotonic request IDs
prevent reflection and replay. Wi-Fi credentials never travel in plaintext.
"""
import json
import secrets
import time

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SERVICE_UUID = "6f8b0001-7c8b-4db3-9c44-7971d0327a8d"
INFO_UUID = "6f8b0002-7c8b-4db3-9c44-7971d0327a8d"
WRITE_UUID = "6f8b0003-7c8b-4db3-9c44-7971d0327a8d"
NOTIFY_UUID = "6f8b0004-7c8b-4db3-9c44-7971d0327a8d"
MAX_MESSAGE = 8192


def key(secret, salt, device_id, direction):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt,
                info=f"sleep-airline-ble-v1:{device_id}:{direction}".encode()).derive(secret.encode())


def seal(secret_key, data, nonce=None):
    nonce = nonce if nonce is not None else secrets.token_bytes(12)
    return nonce + AESGCM(secret_key).encrypt(nonce, json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode(), b"SA-BLE-1")


def unseal(secret_key, payload):
    if not 28 <= len(payload) <= MAX_MESSAGE:
        raise ValueError("invalid_message")
    return json.loads(AESGCM(secret_key).decrypt(payload[:12], payload[12:], b"SA-BLE-1"))


def frames(payload):
    if not 0 < len(payload) <= MAX_MESSAGE:
        raise ValueError("invalid_message")
    for index, offset in enumerate(range(0, len(payload), 18)):
        flags = (1 if offset == 0 else 0) | (2 if offset + 18 >= len(payload) else 0)
        yield bytes([flags, index % 256]) + payload[offset:offset + 18]


class Assembler:
    def __init__(self):
        self.reset()

    def reset(self):
        self.buffer = bytearray()
        self.next = 0
        self.started = None

    def feed(self, packet):
        if not 3 <= len(packet) <= 20 or packet[0] & ~3:
            self.reset()
            raise ValueError("invalid_packet")
        if packet[0] & 1:
            self.reset()
            self.started = time.monotonic()
        if self.started is None or time.monotonic() - self.started > 20 or packet[1] != self.next:
            self.reset()
            raise ValueError("packet_out_of_order")
        self.buffer.extend(packet[2:])
        self.next = (self.next + 1) % 256
        if len(self.buffer) > MAX_MESSAGE:
            self.reset()
            raise ValueError("message_too_large")
        if packet[0] & 2:
            result = bytes(self.buffer)
            self.reset()
            return result
        return None


class Session:
    def __init__(self, device_id, setup_code, expires):
        self.salt = secrets.token_bytes(16)
        self.device_id, self.setup_code, self.expires = device_id, setup_code, expires
        self.read_key = key(setup_code, self.salt, device_id, "c2d")
        self.write_key = key(setup_code, self.salt, device_id, "d2c")
        self.last_id = 0
        self.assembler = Assembler()
        self.authenticated = False

    def info(self):
        return json.dumps({"v": 1, "deviceId": self.device_id, "salt": self.salt.hex(), "expiresAt": self.expires * 1000}).encode()

    def request(self, payload):
        data = unseal(self.read_key, payload)
        if not isinstance(data, dict) or type(data.get("id")) is not int or not self.last_id < data["id"] < 2**31:
            raise ValueError("invalid_request_id")
        if data.get("op") not in ("hello", "networks", "provision", "status") or not isinstance(data.get("args", {}), dict):
            raise ValueError("invalid_request")
        self.last_id = data["id"]
        self.authenticated = True
        return data
