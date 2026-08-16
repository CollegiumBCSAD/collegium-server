import { GameTitle } from '@prisma/client';

export class CreateTeamDto {
  name: string;
  gameTitle: GameTitle;
  universityId: string;
  captainId: string;
  gameHandle: string;
  preferredRole?: string;
}

export class JoinTeamDto {
  userId: string;
  gameHandle: string;
  preferredRole?: string;
  inviteCode?: string;
}
