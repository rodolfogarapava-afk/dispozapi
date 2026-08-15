import { FastifyInstance } from 'fastify'
import { ContactController } from './contacts.controller'
export async function contactRoutes(app: FastifyInstance) {
  const ctrl = new ContactController()
  const auth = { preHandler: [app.authenticate] }
  app.get('/', auth, ctrl.list.bind(ctrl))
  app.get('/group-lists', auth, ctrl.groupLists.bind(ctrl))
  app.get('/group-lists/:groupId', auth, ctrl.groupList.bind(ctrl))
  app.delete('/group-lists/:groupId', auth, ctrl.removeGroupList.bind(ctrl))
  app.post('/', auth, ctrl.create.bind(ctrl))
  app.post('/bulk-import', auth, ctrl.bulkImport.bind(ctrl))
  app.get('/:id', auth, ctrl.findOne.bind(ctrl))
  app.patch('/:id', auth, ctrl.update.bind(ctrl))
  app.delete('/:id', auth, ctrl.remove.bind(ctrl))
}
