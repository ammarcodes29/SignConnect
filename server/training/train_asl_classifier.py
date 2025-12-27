#!/usr/bin/env python3
"""
ASL Alphabet Classifier Training Script

Trains a simple neural network on hand landmark data for ASL letter recognition.
Exports the trained model to TensorFlow.js format.

Usage:
    python train_asl_classifier.py --data path/to/training_data.json --output ../client/public/models/asl_classifier

Requirements:
    pip install tensorflow tensorflowjs numpy scikit-learn
"""

import argparse
import json
import os
import numpy as np
from pathlib import Path

# TensorFlow imports
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

# For train/test split
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder


# ASL Labels
ASL_LABELS = list('ABCDEFGHIJKLMNOPQRSTUVWXYZ')


def load_training_data(data_path: str) -> tuple[np.ndarray, np.ndarray]:
    """Load and parse training data from JSON file."""
    print(f"Loading data from: {data_path}")
    
    with open(data_path, 'r') as f:
        data = json.load(f)
    
    samples = data.get('data', [])
    print(f"Found {len(samples)} samples")
    
    X = []  # Features (landmarks)
    y = []  # Labels (letters)
    
    for sample in samples:
        landmarks = sample.get('landmarks', [])
        letter = sample.get('letter', '')
        
        if len(landmarks) == 63 and letter in ASL_LABELS:
            X.append(landmarks)
            y.append(letter)
    
    print(f"Valid samples: {len(X)}")
    
    # Print distribution
    from collections import Counter
    dist = Counter(y)
    print("\nSample distribution:")
    for letter in ASL_LABELS:
        count = dist.get(letter, 0)
        bar = '█' * (count // 5) if count > 0 else '-'
        print(f"  {letter}: {count:4d} {bar}")
    
    return np.array(X, dtype=np.float32), np.array(y)


def create_model(num_classes: int = 26) -> keras.Model:
    """Create a simple neural network for landmark classification."""
    model = keras.Sequential([
        # Input layer: 63 features (21 landmarks × 3 coords)
        layers.Input(shape=(63,)),
        
        # Hidden layers with dropout for regularization
        layers.Dense(128, activation='relu'),
        layers.BatchNormalization(),
        layers.Dropout(0.3),
        
        layers.Dense(64, activation='relu'),
        layers.BatchNormalization(),
        layers.Dropout(0.3),
        
        layers.Dense(32, activation='relu'),
        layers.Dropout(0.2),
        
        # Output layer: 26 classes (A-Z)
        layers.Dense(num_classes, activation='softmax')
    ])
    
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.001),
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )
    
    return model


def train_model(
    X: np.ndarray, 
    y: np.ndarray, 
    epochs: int = 100,
    batch_size: int = 32
) -> tuple[keras.Model, dict]:
    """Train the model on the provided data."""
    
    # Encode labels to integers
    label_encoder = LabelEncoder()
    label_encoder.fit(ASL_LABELS)
    y_encoded = label_encoder.transform(y)
    
    # Split into train/validation sets
    X_train, X_val, y_train, y_val = train_test_split(
        X, y_encoded, test_size=0.2, random_state=42, stratify=y_encoded
    )
    
    print(f"\nTraining samples: {len(X_train)}")
    print(f"Validation samples: {len(X_val)}")
    
    # Create model
    model = create_model(num_classes=len(ASL_LABELS))
    model.summary()
    
    # Callbacks
    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor='val_accuracy',
            patience=15,
            restore_best_weights=True
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor='val_loss',
            factor=0.5,
            patience=5,
            min_lr=0.0001
        )
    ]
    
    # Train
    print("\nTraining...")
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=epochs,
        batch_size=batch_size,
        callbacks=callbacks,
        verbose=1
    )
    
    # Evaluate
    print("\nFinal evaluation:")
    val_loss, val_acc = model.evaluate(X_val, y_val, verbose=0)
    print(f"Validation accuracy: {val_acc:.4f}")
    print(f"Validation loss: {val_loss:.4f}")
    
    return model, {
        'train_accuracy': history.history['accuracy'][-1],
        'val_accuracy': val_acc,
        'val_loss': val_loss,
        'epochs_trained': len(history.history['accuracy'])
    }


def export_to_tfjs(model: keras.Model, output_dir: str):
    """Export model to TensorFlow.js format."""
    import tensorflowjs as tfjs
    
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    print(f"\nExporting to TensorFlow.js format: {output_path}")
    tfjs.converters.save_keras_model(model, str(output_path))
    
    # Also save as SavedModel format (backup)
    saved_model_path = output_path / 'saved_model'
    model.save(saved_model_path)
    
    print(f"Exported successfully!")
    print(f"  - TensorFlow.js: {output_path}/model.json")
    print(f"  - SavedModel: {saved_model_path}")


def main():
    parser = argparse.ArgumentParser(description='Train ASL Alphabet Classifier')
    parser.add_argument('--data', type=str, required=True, help='Path to training data JSON')
    parser.add_argument('--output', type=str, default='./asl_model', help='Output directory for model')
    parser.add_argument('--epochs', type=int, default=100, help='Max training epochs')
    parser.add_argument('--batch-size', type=int, default=32, help='Batch size')
    
    args = parser.parse_args()
    
    # Load data
    X, y = load_training_data(args.data)
    
    if len(X) < 100:
        print("\n⚠️  Warning: Very few samples. Collect more data for better accuracy!")
    
    # Train model
    model, metrics = train_model(X, y, epochs=args.epochs, batch_size=args.batch_size)
    
    # Export
    export_to_tfjs(model, args.output)
    
    # Save metrics
    metrics_path = Path(args.output) / 'training_metrics.json'
    with open(metrics_path, 'w') as f:
        json.dump(metrics, f, indent=2)
    
    print("\n✅ Training complete!")
    print(f"   Accuracy: {metrics['val_accuracy']:.2%}")
    print(f"   Model saved to: {args.output}")


if __name__ == '__main__':
    main()

