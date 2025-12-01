import 'reflect-metadata';
import { DataSource, Entity, PrimaryGeneratedColumn, Column, Repository } from 'typeorm';
import '../src/common/typeorm-extensions';
import { Transactional } from '../src/decorators/transactional';
import { initializeTransactionalContext } from '../src';
import { addTransactionalDataSource } from '../src';
import { runOnTransactionCommit, runOnTransactionRollback } from '../src/hooks';


@Entity()
class TestEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  value!: string;
}

describe('typeorm-transactional-extension', () => {
  let dataSource: DataSource;
  let repository: Repository<TestEntity>;

  beforeAll(async () => {
    initializeTransactionalContext();
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      synchronize: true,
      entities: [TestEntity],
    });
    await dataSource.initialize();
    addTransactionalDataSource(dataSource);
    repository = dataSource.getRepository(TestEntity);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('should commit transaction with @Transactional', async () => {
    class Service {
      constructor(private repo: Repository<TestEntity>) {}
      @Transactional()
  async create(value: string) {
        const entity = this.repo.create({ value });
        return this.repo.save(entity);
      }
    }
    const service = new Service(repository);
    const result = await service.create('commit');
    expect(result.value).toBe('commit');
    const found = await repository.findOneBy({ id: result.id });
    expect(found).not.toBeNull();
  });

  it('should rollback transaction on error', async () => {
    class Service {
      constructor(private repo: Repository<TestEntity>) {}
      @Transactional()
  async createAndFail(value: string) {
        const entity = this.repo.create({ value });
        await this.repo.save(entity);
        throw new Error('fail');
      }
    }
    const service = new Service(repository);
    await expect(service.createAndFail('rollback')).rejects.toThrow('fail');
    const found = await repository.findOneBy({ value: 'rollback' });
    expect(found).toBeNull();
  });

  it('should call runOnTransactionCommit and runOnTransactionRollback', async () => {
    let commitCalled = false;
    let rollbackCalled = false;

    class Service {
      constructor(private repo: Repository<TestEntity>) {}
      @Transactional()
  async createWithHooks(value: string, shouldFail = false) {
        runOnTransactionCommit(() => { commitCalled = true; });
        runOnTransactionRollback(() => { rollbackCalled = true; });
        const entity = this.repo.create({ value });
        await this.repo.save(entity);
        if (shouldFail) throw new Error('fail');
      }
    }
    const service = new Service(repository);

    // Commit case
    commitCalled = false;
    rollbackCalled = false;
    await service.createWithHooks('commit-hook');
    expect(commitCalled).toBe(true);
    expect(rollbackCalled).toBe(false);

    // Rollback case
    commitCalled = false;
    rollbackCalled = false;
    await expect(service.createWithHooks('rollback-hook', true)).rejects.toThrow('fail');
    expect(commitCalled).toBe(false);
    expect(rollbackCalled).toBe(true);
  });

  it('should throw on updateOrFail and deleteOrFail if no rows affected', async () => {
    await expect(repository.updateOrFail({ id: 9999 }, { value: 'none' })).rejects.toThrow();
    await expect(repository.deleteOrFail({ id: 9999 })).rejects.toThrow();
  });

  it('should succeed on insertOrFail, updateOrFail, deleteOrFail', async () => {
    const entity = await repository.insertOrFail({ value: 'test' });
    expect(entity).toHaveProperty('id');
    const [updateResult, affected] = await repository.updateOrFail({ id: entity.id }, { value: 'updated' });
    expect(affected).toBe(1);
    const [deleteResult, delAffected] = await repository.deleteOrFail({ id: entity.id });
    expect(delAffected).toBe(1);
  });
});
