import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AccountStatus, TeamMemberStatus } from '@prisma/client';

function parseCookies(
  cookieHeader: string | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;

  cookieHeader.split(';').forEach((pair) => {
    const index = pair.indexOf('=');
    if (index === -1) return;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!key) return;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  });

  return result;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function scrimRoom(scrimId: string): string {
  return `scrim:${scrimId}`;
}

interface SocketData {
  userId?: string;
}

function getSocketUserId(client: Socket): string | undefined {
  return (client.data as SocketData).userId;
}

function setSocketUserId(client: Socket, userId: string): void {
  (client.data as SocketData).userId = userId;
}

@WebSocketGateway({
  cors: {
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      process.env.FRONTEND_URL,
    ].filter((origin): origin is string => Boolean(origin)),
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private async authenticate(client: Socket): Promise<string | null> {
    const existingUserId = getSocketUserId(client);
    if (existingUserId) return existingUserId;

    const cookies = parseCookies(client.handshake.headers.cookie);
    const token = cookies['access_token'];
    if (!token) return null;

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || user.status !== AccountStatus.ACTIVE) return null;

      setSocketUserId(client, user.id);
      return user.id;
    } catch {
      return null;
    }
  }

  async handleConnection(client: Socket) {
    const userId = await this.authenticate(client);

    if (!userId) {
      client.disconnect(true);
      return;
    }

    await client.join(userRoom(userId));
  }

  handleDisconnect(client: Socket) {
    const userId = getSocketUserId(client);
    if (userId) {
      this.logger.verbose(`socket disconnected for user ${userId}`);
    }
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(userRoom(userId)).emit(event, payload);
  }

  private async isScrimParticipant(
    userId: string,
    scrimId: string,
  ): Promise<boolean> {
    const scrim = await this.prisma.scrim.findUnique({
      where: { id: scrimId },
      select: { teamId: true, opponentId: true },
    });

    if (!scrim) return false;

    const teamIds = [scrim.teamId, scrim.opponentId].filter(
      (id): id is string => Boolean(id),
    );
    if (teamIds.length === 0) return false;

    const membership = await this.prisma.teamMember.findFirst({
      where: {
        userId,
        teamId: { in: teamIds },
        status: TeamMemberStatus.ACCEPTED,
      },
    });

    return Boolean(membership);
  }

  @SubscribeMessage('scrim:join')
  async handleJoinScrim(
    @ConnectedSocket() client: Socket,
    @MessageBody() scrimId: string,
  ) {
    const userId = await this.authenticate(client);
    if (!userId || !scrimId) return;

    const isParticipant = await this.isScrimParticipant(userId, scrimId);
    if (!isParticipant) return;

    await client.join(scrimRoom(scrimId));
  }

  @SubscribeMessage('scrim:leave')
  async handleLeaveScrim(
    @ConnectedSocket() client: Socket,
    @MessageBody() scrimId: string,
  ) {
    if (!scrimId) return;
    await client.leave(scrimRoom(scrimId));
  }

  emitToScrim(scrimId: string, event: string, payload: unknown) {
    this.server.to(scrimRoom(scrimId)).emit(event, payload);
  }
}
