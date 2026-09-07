/**
 * SUPERSEDED: This is the legacy per-match Glicko-2 calculation service.
 * It is retained temporarily for reference and legacy test compatibility.
 * DO NOT call this service from any active application workflow.
 * The production rating pipeline uses batch closure calculation under ranking/.
 */
import { Injectable } from '@nestjs/common';

export interface GlickoPlayer {
  rating: number;
  rd: number;
  sigma: number;
}

export interface GlickoResult {
  winner: GlickoPlayer;
  loser: GlickoPlayer;
}

@Injectable()
export class GlickoService {
  private readonly TAU = 0.5;
  private readonly SCALE = 173.7178;

  calculateMatch(winner: GlickoPlayer, loser: GlickoPlayer): GlickoResult {
    const updatedWinner = this.updatePlayer(winner, loser, 1);
    const updatedLoser = this.updatePlayer(loser, winner, 0);

    return {
      winner: updatedWinner,
      loser: updatedLoser,
    };
  }

  private updatePlayer(
    player: GlickoPlayer,
    opponent: GlickoPlayer,
    score: number,
  ): GlickoPlayer {
    const mu = (player.rating - 1500) / this.SCALE;
    const phi = player.rd / this.SCALE;
    const sigma = player.sigma;

    const muOpp = (opponent.rating - 1500) / this.SCALE;
    const phiOpp = opponent.rd / this.SCALE;

    const gOpp = 1 / Math.sqrt(1 + (3 * phiOpp * phiOpp) / (Math.PI * Math.PI));
    const expTerm = Math.exp(-gOpp * (mu - muOpp));
    const eVal = 1 / (1 + expTerm);

    const v = 1 / (gOpp * gOpp * eVal * (1 - eVal));
    const delta = v * gOpp * (score - eVal);

    const a = Math.log(sigma * sigma);
    const f = (x: number) => {
      const ex = Math.exp(x);
      const num = ex * (delta * delta - phi * phi - v - ex);
      const denom = 2 * Math.pow(phi * phi + v + ex, 2);
      return num / denom - (x - a) / (this.TAU * this.TAU);
    };

    let A = a;
    let B: number;

    if (delta * delta > phi * phi + v) {
      B = Math.log(delta * delta - phi * phi - v);
    } else {
      let k = 1;
      while (f(a - k * this.TAU) < 0) {
        k++;
      }
      B = a - k * this.TAU;
    }

    let fA = f(A);
    let fB = f(B);

    while (Math.abs(B - A) > 0.000001) {
      const C = A + ((A - B) * fA) / (fB - fA);
      const fC = f(C);

      if (fC * fB < 0) {
        A = B;
        fA = fB;
      } else {
        fA = fA / 2;
      }

      B = C;
      fB = fC;
    }

    const newSigma = Math.exp(A / 2);
    const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
    const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    const newMu = mu + newPhi * newPhi * gOpp * (score - eVal);

    return {
      rating: newMu * this.SCALE + 1500,
      rd: newPhi * this.SCALE,
      sigma: newSigma,
    };
  }
}
