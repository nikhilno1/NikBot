import { NextApiRequest, NextApiResponse } from 'next'
import { PrismaVectorStore } from 'langchain/vectorstores'
import { OpenAIEmbeddings } from 'langchain/embeddings'
import { LLMChain, StuffDocumentsChain, VectorDBQAChain } from 'langchain/chains'
import { OpenAI, PromptTemplate } from 'langchain'
import { PrismaClient, Prisma, documents } from '@prisma/client'
import { personalPromptTemplate } from '../../gloria.config'

export const config = {
  runtime: 'edge',
}

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req: NextApiRequest, res: NextApiResponse) => {
  const question = req.body
  const prisma = new PrismaClient()
  const questionInDB = await prisma.question.create({
    data: {
      content: question,
    },
  })

  //console.log('Added question to DB')

  const vectorStore = PrismaVectorStore.withModel<documents>(prisma).create(
    new OpenAIEmbeddings(),
    {
      prisma: Prisma,
      tableName: 'documents',
      vectorColumnName: 'embedding',
      columns: {
        id: PrismaVectorStore.IdColumn,
        pageContent: PrismaVectorStore.ContentColumn,
      },
    }
  )

  const model = new OpenAI({
    modelName: 'gpt-3.5-turbo',
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.3,
  })

  const promptTemplateBot = /*#__PURE__*/ new PromptTemplate({
    template: personalPromptTemplate,
    inputVariables: ['context', 'question'],
  })

  const llmChain = new LLMChain({ llm: model, prompt: promptTemplateBot })
  const stuffChain = new StuffDocumentsChain({ llmChain })

  const chain = new VectorDBQAChain({
    vectorstore: vectorStore,
    combineDocumentsChain: stuffChain,
    returnSourceDocuments: true,
    k: 4,
  })
  //console.log('Calling OpenAI API with question: ' + question)
  /* Ask it a question and the answer */
  const result = await chain.call({
    query: question,
  })

  // const result = await Promise.race([
  //   chain.call({
  //     query: question,
  //   }),
  //   new Promise((_, reject) =>
  //     setTimeout(() => reject(new Error('Timeout after 10 seconds')), 10000)
  //   ),
  // ])

  //console.log(result)

  await prisma.question.update({
    where: {
      id: questionInDB.id,
    },
    data: {
      answer: result.text,
      successFromLLM: true,
    },
  })

  //console.log('Updated question in DB. Returning 200 OK')

  return res.status(200).json(result)
}
