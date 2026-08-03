import mongoose from 'mongoose';

/**
 * MongoDB connection (ARCHITECTURE.md Section 3 locks Mongoose).
 * Called from the app.ts entrypoint before listen(), so the process fails
 * fast rather than serving requests against a database that is not there.
 */
export const connectDb = async (uri = process.env.MONGO_URI): Promise<void> => {
  if (!uri) {
    throw new Error(
      'MONGO_URI is not set. Copy backend/.env.example to backend/.env, or run via docker compose, which supplies it.',
    );
  }

  mongoose.connection.on('error', (err) => console.error('[mongo] erreur de connexion', err));
  mongoose.connection.on('disconnected', () => console.warn('[mongo] déconnecté'));

  await mongoose.connect(uri);
  console.log(`[mongo] connecté à la base "${mongoose.connection.name}"`);
};

export const disconnectDb = (): Promise<void> => mongoose.disconnect();
