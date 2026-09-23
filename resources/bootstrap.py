#!/usr/bin/env python3
"""DeskApp Agent Bootstrap — called by Electron main process on first launch."""

import sys, os, subprocess, json

def emit(d): sys.stdout.write(json.dumps(d, ensure_ascii=False) + '\n'); sys.stdout.flush()

def bootstrap(app_path, user_data):
    emit({'type': 'progress', 'message': 'Preparing DeskApp engine...', 'percent': 0})
    
    uv = os.path.join(app_path, 'resources', 'uv', 'uv')
    if not os.path.exists(uv):
        emit({'type': 'error', 'message': 'Package manager not found'})
        return None
    
    agent_src = os.path.join(app_path, 'resources', 'hermes-agent')
    if not os.path.exists(os.path.join(agent_src, 'run_agent.py')):
        emit({'type': 'error', 'message': 'Agent source not found'})
        return None
    
    venv_dir = os.path.join(user_data, 'deskapp-agent-venv')
    python_bin = os.path.join(venv_dir, 'bin', 'python3')
    
    if os.path.exists(python_bin):
        emit({'type': 'ready', 'python': python_bin, 'venv': venv_dir})
        return python_bin
    
    try:
        emit({'type': 'progress', 'message': 'Creating Python environment...', 'percent': 20})
        subprocess.run([uv, 'venv', '--python', '3.12', venv_dir], check=True, capture_output=True, timeout=120)
        
        emit({'type': 'progress', 'message': 'Installing DeskApp Agent...', 'percent': 50})
        subprocess.run([uv, 'pip', 'install', '--python', python_bin, '-e', agent_src], check=True, capture_output=True, timeout=300)
        
        emit({'type': 'ready', 'python': python_bin, 'venv': venv_dir})
        return python_bin
    except subprocess.CalledProcessError as e:
        emit({'type': 'error', 'message': str(e.stderr[-200:] if e.stderr else str(e))})
        return None

if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--app-path', required=True)
    p.add_argument('--user-data', required=True)
    a = p.parse_args()
    bootstrap(a.app_path, a.user_data)
