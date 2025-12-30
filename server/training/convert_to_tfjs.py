#!/usr/bin/env python3
"""
Convert trained Keras model to TensorFlow.js format with compatibility fixes.
"""
import json
import shutil
from pathlib import Path

MODEL_DIR = Path('../../client/public/models/asl_classifier')

def fix_model_json():
    """Fix model.json for TFJS compatibility."""
    model_path = MODEL_DIR / 'model.json'
    
    with open(model_path, 'r') as f:
        model = json.load(f)
    
    # Fix InputLayer config - TFJS expects batchInputShape, not batch_shape
    layers = model['modelTopology']['model_config']['config']['layers']
    for layer in layers:
        if layer['class_name'] == 'InputLayer':
            config = layer['config']
            if 'batch_shape' in config and 'batch_input_shape' not in config:
                config['batch_input_shape'] = config.pop('batch_shape')
            # Remove optional field that might cause issues
            config.pop('optional', None)
    
    # Save fixed model
    with open(model_path, 'w') as f:
        json.dump(model, f)
    
    print(f"Fixed model.json at {model_path}")

if __name__ == '__main__':
    fix_model_json()

