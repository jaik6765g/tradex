// ============================================================
// PULSE TRADE SCREEN
// ============================================================

import React from 'react';
import { PulseTrade } from '../components/PulseTrade';

export default function PulseTradeScreen() {
    return (
        <div className="min-h-screen bg-white py-6">
            <div className="max-w-4xl mx-auto px-4">
                <PulseTrade />
            </div>
        </div>
    );
}