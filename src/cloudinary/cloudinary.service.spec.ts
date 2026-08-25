import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';

type UploadCallback = (
  error?: { message: string },
  result?: { secure_url: string; public_id: string },
) => void;

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
      destroy: jest.fn(),
    },
  },
}));

const mockConfigService = {
  get: jest.fn().mockReturnValue('test-value'),
};

describe('CloudinaryService', () => {
  let service: CloudinaryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudinaryService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CloudinaryService>(CloudinaryService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('upload()', () => {
    it('resolves with the secure URL and public ID on success', async () => {
      const fakeStream = { end: jest.fn() };
      (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
        (_opts: unknown, callback: UploadCallback) => {
          callback(undefined, {
            secure_url: 'https://res.cloudinary.com/x/image.png',
            public_id: 'collegium/abc123',
          });
          return fakeStream;
        },
      );

      const result = await service.upload(Buffer.from('fake'));

      expect(result).toEqual({
        url: 'https://res.cloudinary.com/x/image.png',
        publicId: 'collegium/abc123',
      });
      expect(fakeStream.end).toHaveBeenCalled();
    });

    it('rejects when Cloudinary returns an error', async () => {
      const fakeStream = { end: jest.fn() };
      (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
        (_opts: unknown, callback: UploadCallback) => {
          callback({ message: 'upload failed' }, undefined);
          return fakeStream;
        },
      );

      await expect(service.upload(Buffer.from('fake'))).rejects.toThrow();
    });
  });

  describe('destroy()', () => {
    it('calls cloudinary.uploader.destroy with the given public ID', async () => {
      (cloudinary.uploader.destroy as jest.Mock).mockResolvedValue({});

      await service.destroy('collegium/abc123');

      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
        'collegium/abc123',
      );
    });
  });
});
