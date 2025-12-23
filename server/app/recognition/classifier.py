"""
Sign Classifier Module
Deterministic classifier for ASL alphabet + common signs.
Uses extracted hand features for rule-based classification.
"""
from typing import Optional
from dataclasses import dataclass


# MVP Sign Set
ALPHABET_SIGNS = ['A', 'B', 'C', 'E', 'I', 'L', 'O', 'V', 'W', 'Y']
COMMON_SIGNS = ['HELLO', 'THANK_YOU', 'PLEASE', 'YES', 'NO', 'HELP', 'MORE', 'STOP', 'WATER', 'NAME']
ALL_SIGNS = ALPHABET_SIGNS + COMMON_SIGNS


@dataclass
class FingerState:
    """Simplified finger state for rule matching"""
    extended: bool
    curled: bool
    
    @classmethod
    def from_curl(cls, curl_value: float) -> 'FingerState':
        return cls(
            extended=curl_value < 0.35,
            curled=curl_value > 0.6
        )


class SignClassifier:
    """
    Rule-based sign classifier using extracted hand features.
    
    Classification is based on:
    - Finger curl states (extended vs curled)
    - Finger spread patterns
    - Thumb position
    - Palm orientation
    """
    
    def __init__(self):
        self.labels = ALL_SIGNS
        
    def classify(self, landmarks: list, features: Optional[dict] = None) -> dict:
        """
        Classify hand landmarks/features into a sign.
        
        Args:
            landmarks: List of 21 hand landmarks
            features: Extracted features dict (optional)
            
        Returns:
            dict with prediction, confidence, top_k, and issues
        """
        if not landmarks or len(landmarks) < 21:
            return {
                "prediction": None,
                "confidence": 0.0,
                "top_k": [],
                "issues": ["No hand detected"]
            }
        
        # If no features provided, return unknown
        if not features:
            return {
                "prediction": None,
                "confidence": 0.0,
                "top_k": [],
                "issues": ["No features extracted"]
            }
        
        # Extract finger states
        curls = features.get('fingerCurls', {})
        finger_states = {
            'thumb': FingerState.from_curl(curls.get('thumb', 0.5)),
            'index': FingerState.from_curl(curls.get('index', 0.5)),
            'middle': FingerState.from_curl(curls.get('middle', 0.5)),
            'ring': FingerState.from_curl(curls.get('ring', 0.5)),
            'pinky': FingerState.from_curl(curls.get('pinky', 0.5))
        }
        
        thumb_pos = features.get('thumbPosition', 'extended')
        fingers_spread = features.get('fingersSpread', False)
        
        # Run rule-based classification
        matches = []
        
        # Check each sign rule
        for sign in ALPHABET_SIGNS:
            result = self._check_sign_rule(sign, finger_states, thumb_pos, fingers_spread)
            if result['match']:
                matches.append({
                    'sign': sign,
                    'confidence': result['confidence'],
                    'issues': result['issues']
                })
        
        # Sort by confidence
        matches.sort(key=lambda x: x['confidence'], reverse=True)
        
        if not matches:
            return {
                "prediction": None,
                "confidence": 0.0,
                "top_k": [],
                "issues": ["Sign not recognized. Try holding your hand more clearly."]
            }
        
        best = matches[0]
        return {
            "prediction": best['sign'],
            "confidence": round(best['confidence'], 3),
            "top_k": [{"sign": m['sign'], "confidence": round(m['confidence'], 3)} for m in matches[:3]],
            "issues": best['issues']
        }
    
    def _check_sign_rule(
        self, 
        sign: str, 
        fingers: dict, 
        thumb_pos: str, 
        spread: bool
    ) -> dict:
        """
        Check if current hand matches a specific sign's rules.
        Returns match confidence and any issues detected.
        """
        # Default: no match
        result = {'match': False, 'confidence': 0.0, 'issues': []}
        
        # ===== LETTER A =====
        # Fist with thumb extended to side
        if sign == 'A':
            all_curled = all(fingers[f].curled for f in ['index', 'middle', 'ring', 'pinky'])
            thumb_out = thumb_pos == 'extended' or not fingers['thumb'].curled
            
            if all_curled and thumb_out:
                result = {'match': True, 'confidence': 0.85, 'issues': []}
                if not all(fingers[f].curled for f in ['index', 'middle', 'ring', 'pinky']):
                    result['issues'].append("Curl all fingers into a fist")
                    result['confidence'] -= 0.15
            elif all_curled:
                result = {'match': True, 'confidence': 0.6, 'issues': ["Extend thumb to the side"]}
        
        # ===== LETTER B =====
        # All fingers extended and together, thumb tucked
        elif sign == 'B':
            four_extended = all(fingers[f].extended for f in ['index', 'middle', 'ring', 'pinky'])
            thumb_tucked = thumb_pos == 'tucked' or thumb_pos == 'across'
            
            if four_extended and thumb_tucked:
                result = {'match': True, 'confidence': 0.9, 'issues': []}
                if spread:
                    result['issues'].append("Keep fingers together")
                    result['confidence'] -= 0.1
            elif four_extended:
                result = {'match': True, 'confidence': 0.7, 'issues': ["Tuck thumb across palm"]}
        
        # ===== LETTER C =====
        # Curved hand like holding a cup
        elif sign == 'C':
            # Fingers partially curled (not fully extended, not fully curled)
            partially_curled = all(
                not fingers[f].extended and not fingers[f].curled 
                for f in ['index', 'middle', 'ring', 'pinky']
            )
            thumb_out = thumb_pos == 'extended'
            
            if partially_curled and thumb_out:
                result = {'match': True, 'confidence': 0.8, 'issues': []}
            elif partially_curled:
                result = {'match': True, 'confidence': 0.6, 'issues': ["Curve thumb to match fingers"]}
        
        # ===== LETTER E =====
        # All fingers curled, thumb tucked
        elif sign == 'E':
            all_curled = all(fingers[f].curled for f in ['index', 'middle', 'ring', 'pinky'])
            thumb_tucked = thumb_pos == 'tucked'
            
            if all_curled and thumb_tucked:
                result = {'match': True, 'confidence': 0.85, 'issues': []}
            elif all_curled:
                result = {'match': True, 'confidence': 0.65, 'issues': ["Tuck thumb under fingers"]}
        
        # ===== LETTER I =====
        # Only pinky extended
        elif sign == 'I':
            pinky_up = fingers['pinky'].extended
            others_down = all(fingers[f].curled for f in ['index', 'middle', 'ring'])
            
            if pinky_up and others_down:
                result = {'match': True, 'confidence': 0.9, 'issues': []}
            elif pinky_up:
                result = {'match': True, 'confidence': 0.6, 'issues': ["Curl other fingers down"]}
        
        # ===== LETTER L =====
        # Index extended, thumb extended at 90°
        elif sign == 'L':
            index_up = fingers['index'].extended
            thumb_out = thumb_pos == 'extended'
            others_down = all(fingers[f].curled for f in ['middle', 'ring', 'pinky'])
            
            if index_up and thumb_out and others_down:
                result = {'match': True, 'confidence': 0.9, 'issues': []}
            elif index_up and others_down:
                result = {'match': True, 'confidence': 0.7, 'issues': ["Extend thumb out to form L shape"]}
        
        # ===== LETTER O =====
        # All fingers curved to touch thumb (circle shape)
        elif sign == 'O':
            all_curved = all(
                not fingers[f].extended 
                for f in ['index', 'middle', 'ring', 'pinky']
            )
            if all_curved:
                result = {'match': True, 'confidence': 0.75, 'issues': []}
        
        # ===== LETTER V =====
        # Index and middle extended (peace sign)
        elif sign == 'V':
            two_up = fingers['index'].extended and fingers['middle'].extended
            others_down = all(fingers[f].curled for f in ['ring', 'pinky'])
            
            if two_up and others_down:
                result = {'match': True, 'confidence': 0.9, 'issues': []}
                if not spread:
                    result['issues'].append("Spread index and middle fingers apart")
                    result['confidence'] -= 0.1
            elif two_up:
                result = {'match': True, 'confidence': 0.65, 'issues': ["Curl ring and pinky fingers"]}
        
        # ===== LETTER W =====
        # Index, middle, ring extended
        elif sign == 'W':
            three_up = all(fingers[f].extended for f in ['index', 'middle', 'ring'])
            pinky_down = fingers['pinky'].curled
            
            if three_up and pinky_down:
                result = {'match': True, 'confidence': 0.85, 'issues': []}
                if not spread:
                    result['issues'].append("Spread fingers apart")
                    result['confidence'] -= 0.1
            elif three_up:
                result = {'match': True, 'confidence': 0.65, 'issues': ["Curl pinky down"]}
        
        # ===== LETTER Y =====
        # Thumb and pinky extended (hang loose)
        elif sign == 'Y':
            pinky_up = fingers['pinky'].extended
            thumb_out = thumb_pos == 'extended' or not fingers['thumb'].curled
            others_down = all(fingers[f].curled for f in ['index', 'middle', 'ring'])
            
            if pinky_up and thumb_out and others_down:
                result = {'match': True, 'confidence': 0.9, 'issues': []}
            elif pinky_up and others_down:
                result = {'match': True, 'confidence': 0.7, 'issues': ["Extend thumb out"]}
        
        return result


# Singleton instance
_classifier_instance: Optional[SignClassifier] = None

def get_classifier() -> SignClassifier:
    global _classifier_instance
    if _classifier_instance is None:
        _classifier_instance = SignClassifier()
    return _classifier_instance
