import * as Realm from 'realm-web';
import { config } from './config';

// MongoDB Atlas App Services 초기화
const app = config.mongodbAppId ? new Realm.App({ id: config.mongodbAppId }) : null;

// MongoDB 설정 유효성 검사
export const isMongoDBConfigured = Boolean(
  config.mongodbAppId && 
  config.mongodbAppId !== 'your-mongodb-app-id'
);

/**
 * MongoDB 클라이언트 및 데이터베이스 접근 도구
 */
export async function getMongoClient() {
  if (!app || !isMongoDBConfigured) return null;
  
  // 익명 인증으로 로그인 (읽기/기록용)
  if (!app.currentUser) {
    await app.logIn(Realm.Credentials.anonymous());
  }
  
  // MongoDB 서비스 접근
  const mongodb = app.currentUser!.mongoClient('mongodb-atlas');
  return {
    db: mongodb.db('rofolder'), // 데이터베이스 이름
    app
  };
}

export { app };
