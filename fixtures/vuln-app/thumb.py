# TEST FIXTURE for Patchwork. Flaw: shell command built from user input.
import subprocess
from flask import Flask, request

app = Flask(__name__)


@app.route("/thumb")
def thumb():
    name = request.args.get("file", "")
    out = subprocess.check_output("convert uploads/" + name + " -resize 100x100 thumb.png", shell=True)
    return out
