"""
Sign Classifier Module
Deterministic classifier for ASL alphabet + common signs.
"""
from typing import Optional
import random


# MVP Sign Set
ALPHABET_SIGNS = ['A', 'B', 'C', 'E', 'I', 'L', 'O', 'V', 'W', 'Y']
COMMON_SIGNS = ['HELLO', 'THANK_YOU', 'PLEASE', 'YES', 'NO', 'HELP', 'MORE', 'STOP', 'WATER', 'NAME']
ALL_SIGNS = ALPHABET_SIGNS + COMMON_SIGNS


class SignClassifier:
    """
    Lightweight sign classifier using rules + features.
    
    For MVP: returns stub predictions.
    TODO: Implement actual classification logic based on:
    - Finger curl angles
    - Fingertip distances
    - Palm orientation
    - Thumb position
    """
    
    def __init__(self):
        self.labels = ALL_SIGNS
        
    def classify(self, landmarks: list) -> dict:
        """
        Classify hand landmarks into a sign.
        
        Args:
            landmarks: List of 21 hand landmarks with x, y, z coordinates
            
        Returns:
            dict with prediction, confidence, top_k, and issues
        """
        # STUB: Return random prediction for demo
        # TODO: Implement actual feature extraction + classification
        if not landmarks or len(landmarks) < 21:
            return {
                "prediction": None,
                "confidence": 0.0,
                "top_k": [],
                "issues": ["No hand detected"]
            }
        
        # Stub: Pick a random letter with fake confidence
        prediction = random.choice(ALPHABET_SIGNS)
        confidence = random.uniform(0.7, 0.99)
        
        # Top-k predictions
        top_k = [
            {"sign": prediction, "confidence": confidence},
            {"sign": random.choice(ALPHABET_SIGNS), "confidence": confidence * 0.6},
            {"sign": random.choice(ALPHABET_SIGNS), "confidence": confidence * 0.3},
        ]
        
        return {
            "prediction": prediction,
            "confidence": round(confidence, 3),
            "top_k": top_k,
            "issues": []  # No issues in stub
        }
    
    def extract_features(self, landmarks: list) -> dict:
        """
        Extract features from hand landmarks for classification.
        
        TODO: Implement:
        - Normalized landmark positions
        - Finger curl angles (MCP, PIP, DIP joints)
        - Fingertip distances (from palm, from each other)
        - Palm orientation (normal vector)
        - Thumb position relative to palm
        """
        return {
            "normalized_landmarks": landmarks,
            "finger_curls": {},
            "fingertip_distances": {},
            "palm_orientation": None,
        }

