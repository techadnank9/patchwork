# TEST FIXTURE for Patchwork. Flaw: SQL built by string concatenation.
import sqlite3
from flask import Flask, request, jsonify

app = Flask(__name__)


def get_db():
    return sqlite3.connect("items.db")


@app.route("/search")
def search():
    term = request.args.get("q", "")
    conn = get_db()
    rows = conn.execute("SELECT * FROM items WHERE name LIKE '%" + term + "%'").fetchall()
    return jsonify([list(r) for r in rows])
